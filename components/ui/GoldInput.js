'use client';
import { useState } from 'react';

export default function GoldInput({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  style = {},
  inputStyle = {},
  ...props
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value !== undefined ? !!value : undefined;

  // If value is controlled externally, use that; otherwise track internally
  const [internalVal, setInternalVal] = useState('');
  const val = value !== undefined ? value : internalVal;

  const handleChange = (e) => {
    if (onChange) onChange(e);
    else setInternalVal(e.target.value);
  };

  const floated = focused || !!val;

  return (
    <div style={{ position: 'relative', ...style }}>
      {label && (
        <label style={{
          position: 'absolute', left: 14,
          top: floated ? -8 : 14,
          fontSize: floated ? 9 : 12,
          color: focused ? '#FFD700' : '#8B6914',
          letterSpacing: '0.1em',
          transition: 'all 0.2s ease',
          pointerEvents: 'none',
          background: floated ? '#0f0f0f' : 'transparent',
          padding: floated ? '0 4px' : 0,
          zIndex: 1,
        }}>
          {label}
        </label>
      )}
      <input
        type={type}
        value={val}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={!label ? placeholder : ''}
        style={{
          width: '100%',
          background: '#0f0f0f',
          border: `1px solid ${focused ? '#FFD700' : 'rgba(201,168,76,0.2)'}`,
          borderRadius: 4,
          padding: '12px 14px',
          color: '#e8d9b0',
          fontFamily: "'DM Mono', 'Geist Mono', monospace",
          fontSize: 12,
          outline: 'none',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          boxShadow: focused ? '0 0 0 3px rgba(255,215,0,0.08)' : 'none',
          ...inputStyle,
        }}
        {...props}
      />
    </div>
  );
}
