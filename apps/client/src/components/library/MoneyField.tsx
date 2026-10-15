/**
 * 金额字段：金额 + 币种（可搜索的下拉）。默认币种 = 上次用的（资料库里最近改过的那条），一开始是人民币。
 * 粘贴「$12.5」「£30」会同时填好金额和币种。不做换算。文案见 docs/COPY.md。
 */
import { useEffect, useState } from 'react';
import { Autocomplete, Button as RacButton, Input, ListBox, ListBoxItem, Popover, SearchField, Select, SelectValue, type Key } from 'react-aria-components';
import { Check, ChevronDown, Search } from 'lucide-react';
import { CURRENCIES, currencyName, currencySearchText, currencyOf, formatMoney, moneyOf, parseMoney, recentCurrency, type FieldDef, type FieldValue, type Store } from '@mindough/core';
import { Field } from '../../ui/primitives';

import { dataLabel, tr } from '../../lib/i18n';


/** 币种选择：按钮显示「¥ CNY」，弹出可搜索的列表（中文名、代码、符号都能搜）。 */
export function CurrencySelect({ value, onChange, label = tr('币种') }: { value: string; onChange: (code: string) => void; label?: string }) {
  const cur = currencyOf(value);
  return (
    <Select aria-label={label} className="currency-select" value={value} onChange={(k: Key | null) => k !== null && onChange(String(k))}>
      <RacButton className="input select-btn currency-btn">
        <SelectValue className="select-value">{() => (cur ? `${cur.symbol} ${cur.code}` : value)}</SelectValue>
        <ChevronDown size={16} aria-hidden />
      </RacButton>
      <Popover className="popover currency-popover" placement="bottom end">
        <Autocomplete filter={(text, input) => text.includes(input.trim().toLowerCase())}>
          <SearchField aria-label={tr('搜币种')} className="currency-search" autoFocus>
            <Search size={14} aria-hidden className="currency-search-icon" />
            <Input className="input currency-search-input" placeholder={tr('搜币种：美元、USD、$')} />
          </SearchField>
          <ListBox className="listbox currency-list" items={CURRENCIES} renderEmptyState={() => <div className="pick-empty">{tr('没有这个币种')}</div>}>
            {(c) => (
              <ListBoxItem id={c.code} className="listbox-item pick-item" textValue={currencySearchText(c)}>
                <span className="currency-symbol">{c.symbol}</span>
                <span className="grow">{currencyName(c)}</span>
                <span className="pick-meta">{c.code}</span>
                <Check size={14} className="pick-check" aria-hidden />
              </ListBoxItem>
            )}
          </ListBox>
        </Autocomplete>
      </Popover>
    </Select>
  );
}

export function MoneyInput({ store, def, value, onChange }: { store: Store; def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const fallback = () => recentCurrency(store.list('library_item'));
  const m = moneyOf(value, fallback());
  const [currency, setCurrency] = useState(() => m?.currency ?? fallback());
  const [text, setText] = useState(m ? String(m.amount) : '');
  useEffect(() => {
    // 外部换了值（换了一条资料）：跟上
    const n = moneyOf(value, currency);
    if (n && (Number(text.replace(/,/g, '')) !== n.amount || n.currency !== currency)) {
      setText(String(n.amount));
      setCurrency(n.currency);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = text.trim() === '' ? null : Number(text.replace(/[,\s]/g, ''));
  const bad = amount !== null && !Number.isFinite(amount);
  const emit = (t: string, c: string) => {
    const a = t.trim() === '' ? null : Number(t.replace(/[,\s]/g, ''));
    onChange(a === null || !Number.isFinite(a) ? (t.trim() ? value ?? null : null) : { amount: a, currency: c });
  };
  return (
    <div className="money-field">
      <Field
        className="grow"
        label={dataLabel(def.label)}
        value={text}
        inputMode="decimal"
        placeholder={def.placeholder ? dataLabel(def.placeholder) : '0'}
        isInvalid={bad}
        {...(bad ? { description: tr('金额只写数字就好') } : amount !== null && !bad && amount >= 1000 ? { description: formatMoney({ amount, currency }) } : {})}
        onChange={(t) => {
          setText(t);
          emit(t, currency);
        }}
        onPaste={(t, e) => {
          const p = parseMoney(t, currency);
          if (p && /[^\d.,\s]/.test(t)) {
            e.preventDefault();
            setText(String(p.amount));
            setCurrency(p.currency);
            onChange(p);
          }
        }}
      />
      <CurrencySelect
        value={currency}
        onChange={(c) => {
          setCurrency(c);
          emit(text, c);
        }}
      />
    </div>
  );
}
