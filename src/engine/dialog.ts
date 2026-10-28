export interface DialogField {
  key: string;
  label: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "number" | "checkbox" | "select";
  options?: { value: string; label: string }[];
}

export interface DialogState {
  kind: "form" | "confirm";
  title: string;
  desc?: string;
  fields?: DialogField[];
  danger?: boolean;
  okText?: string;
  onOk: (values: Record<string, string>) => void;
}
