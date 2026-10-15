/**
 * Headless React Aria 组件 + 语义类名。外观全部来自皮肤层（tokens.css / app.css / skins.css）。
 */
import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  Button as RacButton,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  NumberField,
  Popover,
  Select as RacSelect,
  SelectValue,
  Text,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  TooltipTrigger,
  type ButtonProps,
  type PopoverProps,
  type Key,
} from 'react-aria-components';
import { Check, ChevronDown, MoreHorizontal, X } from 'lucide-react';
import { useSettings } from '../lib/settings';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'tonal' | 'quiet';

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
  className,
  headerStart,
  headerEnd,
  titleHidden,
  onKeyDown,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** 额外的 modal 类名（composer / detail 等，皮肤按它调形状）。 */
  className?: string;
  /** 标题前（状态徽章等）。 */
  headerStart?: ReactNode;
  /** 关闭按钮前（更多菜单等）。 */
  headerEnd?: ReactNode;
  /** 标题只给读屏用，不显示。 */
  titleHidden?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const { layout } = useSettings();
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="overlay">
      <Modal className={`modal ${layout === 'mobile' ? 'modal-sheet' : 'modal-center'}${wide ? ' modal-wide' : ''}${className ? ` ${className}` : ''}`}>
        <Dialog className="dialog" aria-label={title}>
          {({ close }) => (
            <div className="dialog-inner" onKeyDown={onKeyDown}>
              <div className="sheet-grabber" aria-hidden />
              <div className="dialog-head">
                {headerStart}
                <Heading slot="title" className={`dialog-title${titleHidden ? ' sr-only' : ''}`}>
                  {title}
                </Heading>
                {titleHidden && <span className="grow" />}
                {headerEnd}
                <IconButton label="关闭" className="dialog-close" onPress={close}>
                  <X size={18} />
                </IconButton>
              </div>
              <div className="dialog-body">{children}</div>
              {footer && <div className="dialog-foot">{footer}</div>}
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 点一下弹出的小面板（属性编辑用）。trigger 是一个 React Aria Button。 */
export function PopoverPanel({
  trigger,
  children,
  label,
  placement = 'bottom start',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  label: string;
  placement?: PopoverProps['placement'];
  className?: string;
}) {
  return (
    <DialogTrigger>
      {trigger}
      <Popover className={`popover popover-panel${className ? ` ${className}` : ''}`} placement={placement} offset={6}>
        <Dialog className="popover-dialog" aria-label={label}>
          {({ close }) => (typeof children === 'function' ? children(close) : children)}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function Tip({ content, children, delay = 400 }: { content: ReactNode; children: ReactNode; delay?: number }) {
  return (
    <TooltipTrigger delay={delay}>
      {children}
      <Tooltip className="tooltip" offset={6}>
        {content}
      </Tooltip>
    </TooltipTrigger>
  );
}

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onAction: () => void;
}

/** ··· 更多菜单。 */
export function OverflowMenu({ label = '更多', items }: { label?: string; items: MenuAction[] }) {
  return (
    <MenuTrigger>
      <RacButton aria-label={label} className="icon-btn">
        <MoreHorizontal size={18} />
      </RacButton>
      <Popover className="popover menu-popover" placement="bottom end" offset={4}>
        <Menu className="menu" onAction={(k) => items.find((i) => i.id === k)?.onAction()}>
          {items.map((i) => (
            <MenuItem key={i.id} id={i.id} className={`menu-item${i.danger ? ' is-danger' : ''}`} textValue={i.label}>
              {i.icon}
              <span>{i.label}</span>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** 确认框（删除等不可撤销的操作）。 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="overlay overlay-alert">
      <Modal className="modal modal-alert">
        <Dialog role="alertdialog" className="dialog alert" aria-label={title}>
          {({ close }) => (
            <>
              <Heading slot="title" className="alert-title">
                {title}
              </Heading>
              <div className="alert-message">{message}</div>
              <div className="alert-actions">
                <Button variant="secondary" onPress={close} autoFocus>
                  取消
                </Button>
                <Button
                  variant={danger ? 'danger-solid' : 'primary'}
                  onPress={() => {
                    onConfirm();
                    close();
                  }}
                >
                  {confirmLabel}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 句子里的小数字框：「每次 [10] 分钟」。 */
export function InlineNumber({ label, value, onChange, min = 1, max, width = 4 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; width?: number }) {
  return (
    <NumberField
      aria-label={label}
      className="inline-field"
      value={value}
      minValue={min}
      {...(max !== undefined ? { maxValue: max } : {})}
      onChange={(v) => Number.isFinite(v) && onChange(v)}
      formatOptions={{ maximumFractionDigits: 2, useGrouping: false }}
    >
      <Input className="input inline-input" style={{ width: `calc(${width}ch + 22px)` }} />
    </NumberField>
  );
}

/** 句子里的小文本框：「目标 8 [杯]」。 */
export function InlineText({ label, value, onChange, placeholder, width = 5 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <TextField aria-label={label} className="inline-field" value={value} onChange={onChange}>
      <Input className="input inline-input" placeholder={placeholder} style={{ width: `calc(${width}ch + 22px)` }} />
    </TextField>
  );
}

/** 跟着内容长高的无边框文本框（正文用）。 */
export function AutoTextarea({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
  minRows = 2,
  onBlur,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  minRows?: number;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      className={`bare-textarea${className ? ` ${className}` : ''}`}
      value={value}
      rows={minRows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
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
  description,
  isInvalid,
  onBlur,
  onPaste,
  inputClassName,
  inputMode,
  adornment,
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
  /** 输入框下面的一行轻提示（格式不对、预览链接）。 */
  description?: ReactNode;
  isInvalid?: boolean;
  onBlur?: () => void;
  onPaste?: (text: string, e: ClipboardEvent<HTMLInputElement>) => void;
  inputClassName?: string;
  inputMode?: 'decimal' | 'numeric' | 'text' | 'url';
  /** 输入框右端的小按钮 / 链接（如站点编号的「打开」）。传了（含 null）输入框就放进 .input-wrap。 */
  adornment?: ReactNode;
}) {
  const input = (
    <Input
      className={`input${inputClassName ? ` ${inputClassName}` : ''}${adornment ? ' has-adornment' : ''}`}
      placeholder={placeholder}
      {...(inputMode ? { inputMode } : {})}
      {...(onPaste ? { onPaste: (e: ClipboardEvent<HTMLInputElement>) => onPaste(e.clipboardData.getData('text'), e) } : {})}
    />
  );
  return (
    <TextField
      className={`field${className ? ` ${className}` : ''}`}
      value={value}
      onChange={onChange}
      type={multiline ? undefined : type}
      autoFocus={autoFocus}
      isInvalid={!!isInvalid}
      {...(onBlur ? { onBlur } : {})}
    >
      <Label className="field-label">{label}</Label>
      {multiline ? (
        <TextArea className="input textarea" rows={rows ?? 6} placeholder={placeholder} />
      ) : adornment !== undefined ? (
        // 传了 adornment（哪怕暂时是 null）就一直包一层：输入到一半出现「打开」时输入框不重挂、不丢焦点
        <div className="input-wrap">
          {input}
          {adornment && <span className="input-adornment">{adornment}</span>}
        </div>
      ) : (
        input
      )}
      {description && (
        <Text slot="description" className={`field-hint${isInvalid ? ' is-invalid' : ''}`}>
          {description}
        </Text>
      )}
    </TextField>
  );
}

/** 多选下拉：按钮上显示选中的几项（「不选」= 空），弹出带勾的列表，可以连着点几项。 */
export function MultiSelect({
  label,
  value,
  onChange,
  options,
  className,
  emptyLabel = '不选',
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  className?: string;
  emptyLabel?: string;
}) {
  const text = options.filter((o) => value.includes(o.id)).map((o) => o.label).join('、');
  return (
    <RacSelect
      className={`field multi-select${className ? ` ${className}` : ''}`}
      selectionMode="multiple"
      value={value}
      onChange={(keys) => onChange(options.map((o) => o.id).filter((id) => (keys as Key[]).map(String).includes(id)))}
      placeholder={emptyLabel}
    >
      <Label className="field-label">{label}</Label>
      <RacButton className="input select-btn">
        <span className={`select-value${text ? '' : ' is-placeholder'}`}>{text || emptyLabel}</span>
        <ChevronDown size={16} aria-hidden />
      </RacButton>
      <Popover className="popover multi-select-popover">
        <ListBox className="listbox" items={options}>
          {(o) => (
            <ListBoxItem id={o.id} className="listbox-item pick-item" textValue={o.label}>
              <span className="grow">{o.label}</span>
              <Check size={15} className="pick-check" aria-hidden />
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RacSelect>
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
