/**
 * Headless React Aria 组件 + 语义类名。外观全部来自皮肤层（tokens.css / app.css / skins.css）。
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  Button as RacButton,
  Dialog,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select as RacSelect,
  SelectValue,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  type ButtonProps,
  type Key,
} from 'react-aria-components';
import { ChevronDown, X } from 'lucide-react';
import { useSettings } from '../lib/settings';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tonal';

export function Button({ variant = 'secondary', className, ...props }: ButtonProps & { variant?: Variant }) {
  return <RacButton {...props} className={`btn btn-${variant}${className ? ` ${String(className)}` : ''}`} />;
}

export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return <RacButton {...props} aria-label={label} className={`icon-btn${className ? ` ${String(className)}` : ''}`} />;
}

export function Sheet({
  isOpen,
  onOpenChange,
  title,
  children,
  footer,
  wide,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { layout } = useSettings();
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="overlay">
      <Modal className={`modal ${layout === 'mobile' ? 'modal-sheet' : 'modal-center'}${wide ? ' modal-wide' : ''}`}>
        <Dialog className="dialog" aria-label={title}>
          {({ close }) => (
            <>
              <div className="dialog-head">
                <Heading slot="title" className="dialog-title">
                  {title}
                </Heading>
                <IconButton label="关闭" onPress={close}>
                  <X size={18} />
                </IconButton>
              </div>
              <div className="dialog-body">{children}</div>
              {footer && <div className="dialog-foot">{footer}</div>}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  multiline,
  rows,
  autoFocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <TextField className={`field${className ? ` ${className}` : ''}`} value={value} onChange={onChange} type={multiline ? undefined : type} autoFocus={autoFocus}>
      <Label className="field-label">{label}</Label>
      {multiline ? <TextArea className="input textarea" rows={rows ?? 6} placeholder={placeholder} /> : <Input className="input" placeholder={placeholder} />}
    </TextField>
  );
}

export interface Option {
  id: string;
  label: string;
}

export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
}) {
  return (
    <RacSelect
      className={`field${className ? ` ${className}` : ''}`}
      selectedKey={value}
      onSelectionChange={(k: Key | null) => k !== null && onChange(String(k))}
    >
      <Label className="field-label">{label}</Label>
      <RacButton className="input select-btn">
        <SelectValue className="select-value" />
        <ChevronDown size={16} aria-hidden />
      </RacButton>
      <Popover className="popover">
        <ListBox className="listbox" items={options}>
          {(o) => (
            <ListBoxItem id={o.id} className="listbox-item" textValue={o.label}>
              {o.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RacSelect>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: ReactNode }>;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className="segmented"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const k = [...keys][0];
        if (k !== undefined) onChange(String(k) as T);
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.id} id={o.id} className="segmented-item">
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function Chip({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`chip${className ? ` ${className}` : ''}`} style={color ? ({ '--chip-color': color } as CSSProperties) : undefined}>
      {children}
    </span>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

export function Section({ title, extra, children, className }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section${className ? ` ${className}` : ''}`}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="progress-fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

export function ProgressRing({ value, size = 28, stroke = 3, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <span className="ring-label">{children}</span>}
    </span>
  );
}

/** 横向可滑动的单选标签（分类筛选等选项多的场合）。 */
export function ChipPicker<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: ReactNode; color?: string }>;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className="chip-picker"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const k = [...keys][0];
        if (k !== undefined) onChange(String(k) as T);
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.id} id={o.id} className="chip-pick" style={o.color ? ({ '--chip-color': o.color } as CSSProperties) : undefined}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
