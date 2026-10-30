import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string };

/** Password field with a show or hide button. The value is never logged or copied anywhere. */
export const PasswordInput: React.FC<Props> = ({ className, style, ...inputProps }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        className={className ?? "glass-input"}
        spellCheck={false}
        autoCorrect="off"
        style={{ ...style, paddingRight: "48px" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-controls={inputProps.id}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: "44px", minHeight: "44px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)",
        }}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
};
