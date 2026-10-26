import type { ReactNode } from 'react';

/**
 * 页头。compact（项目页，Rei 2026-10-26「标题和图标左上角，小一点，和右侧图标对齐」）：
 * 图标、标题、副标题和右边的图标按钮在同一行，垂直居中、同高；副标题跟在标题后面、放不下就省略。
 */
export function PageHeader({ title, subtitle, icon, actions, compact = false }: { title: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  if (compact)
    return (
      <header className="page-header is-compact">
        <div className="page-heading">
          {icon && <span className="page-icon">{icon}</span>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
    );
  return (
    <header className="page-header">
      <div className="page-heading">
        {icon && <span className="page-icon">{icon}</span>}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
