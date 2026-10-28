use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serialport::{SerialPort, SerialPortType};
use tauri::{AppHandle, Emitter, State};

/// 串口句柄状态：写句柄留在状态里，读句柄移交给独立读线程
struct SerialState {
    port: Mutex<Option<Box<dyn SerialPort>>>,
    alive: Arc<AtomicBool>,
}

impl Default for SerialState {
    fn default() -> Self {
        Self {
            port: Mutex::new(None),
            alive: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Serialize)]
struct PortInfo {
    name: String,
    kind: String,
    detail: String,
}

#[tauri::command]
fn list_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let (kind, detail) = match &p.port_type {
                SerialPortType::UsbPort(info) => (
                    "usb".to_string(),
                    format!(
                        "{} VID:{:04X} PID:{:04X}",
                        info.product.clone().unwrap_or_else(|| "USB-SERIAL".into()),
                        info.vid,
                        info.pid
                    ),
                ),
                SerialPortType::BluetoothPort => ("bluetooth".to_string(), "蓝牙串口".to_string()),
                SerialPortType::PciPort => ("pci".to_string(), "PCI 串口".to_string()),
                SerialPortType::Unknown => ("unknown".to_string(), "未知设备".to_string()),
            };
            PortInfo {
                name: p.port_name,
                kind,
                detail,
            }
        })
        .collect())
}

#[tauri::command]
fn open_port(
    app: AppHandle,
    state: State<'_, SerialState>,
    path: String,
    baud: u32,
    data_bits: Option<u8>,
    stop_bits: Option<u8>,
    parity: Option<String>,
    flow_control: Option<String>,
) -> Result<String, String> {
    // 先关掉旧连接
    state.alive.store(false, Ordering::SeqCst);
    {
        let mut guard = state.port.lock().map_err(|e| e.to_string())?;
        if let Some(mut old) = guard.take() {
            let _ = old.clear(ClearBuffer::All);
        }
    }

    let db = match data_bits.unwrap_or(8) {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };
    let sb = match stop_bits.unwrap_or(1) {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };
    let par = match parity.as_deref().unwrap_or("none") {
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };
    let fc = match flow_control.as_deref().unwrap_or("none") {
        "hardware" => serialport::FlowControl::Hardware,
        "software" => serialport::FlowControl::Software,
        _ => serialport::FlowControl::None,
    };

    let port = serialport::new(&path, baud)
        .data_bits(db)
        .parity(par)
        .stop_bits(sb)
        .flow_control(fc)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("打开 {path} 失败：{e}"))?;

    let mut reader = port.try_clone().map_err(|e| e.to_string())?;

    {
        let mut guard = state.port.lock().map_err(|e| e.to_string())?;
        *guard = Some(port);
    }

    state.alive.store(true, Ordering::SeqCst);
    let alive = state.alive.clone();
    let port_name = path.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while alive.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    let _ = app.emit("serial://data", buf[..n].to_vec());
                }
                Err(ref e) if e.kind() == ErrorKind::TimedOut => {}
                Err(ref e) if e.kind() == ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        let _ = app.emit("serial://closed", port_name);
    });

    Ok(path)
}

#[tauri::command]
fn write_port(state: State<'_, SerialState>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(port) => port.write_all(&data).map_err(|e| e.to_string()),
        None => Err("串口未打开".into()),
    }
}

#[tauri::command]
fn close_port(state: State<'_, SerialState>) -> Result<(), String> {
    state.alive.store(false, Ordering::SeqCst);
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

use serialport::ClearBuffer;

pub fn run() {
    tauri::Builder::default()
        .manage(SerialState::default())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            open_port,
            write_port,
            close_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running SerialMind");
}
