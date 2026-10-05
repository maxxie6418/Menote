/**
 * 账户快捷菜单的配置卡片（components.md §五 的 `cardQuickMenu`；功能拆解 M18-03）。
 *
 * 5 个候选功能一行一个开关，**即时生效**；清单来自 `@menote/shared` 的 `QUICK_MENU_FEATURES`——
 * 菜单与设置页**同一份数据驱动**（规格要求），所以这里不另抄一份名单。
 *
 * **【2026-10-04】5 个候选至此全部可用**，所以 `pendingStep` 那一列当前全为 `null`、
 * 这一张卡上不会出现任何"将在 X 生效"的标记。**那套机制没有删**——将来再加未交付的候选时，
 * `QUICK_MENU_FEATURES` 填上 `pendingStep`，这里照旧把原因平铺出来
 * （DESIGN.md §6.1：禁用要说明原因，且不能只靠悬停）。
 */
import { QUICK_MENU_FEATURES, type QuickMenuFeature } from "@menote/shared";
import { InfoHint } from "../../../app/ui/InfoHint";

export interface CardQuickMenuProps {
  selected: readonly QuickMenuFeature[];
  onChange: (next: QuickMenuFeature[]) => void;
}

export function CardQuickMenu({ selected, onChange }: CardQuickMenuProps) {
  function toggle(id: QuickMenuFeature, on: boolean): void {
    // 保持清单顺序（= 菜单里的显示顺序），所以按候选顺序重建而不是字符串拼接
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(QUICK_MENU_FEATURES.filter((feature) => next.has(feature.id)).map((f) => f.id));
  }

  return (
    <section className="setcard" aria-label="账户快捷菜单">
      <h3 className="setcard__title">
        账户快捷菜单
        {/* 口径说明收 InfoHint（DESIGN.md §5.4-1）；每一行自己的状态仍逐行可见 */}
        <InfoHint label="账户快捷菜单说明">
          点头像弹出的菜单里显示哪些功能，勾选即时生效；「设置」与「退出登录」固定在底部、不在此列。
          「立即备份」是**入口**：点了去「备份与导出」那一页，推哪个目标由你自己选。
        </InfoHint>
      </h3>
      {QUICK_MENU_FEATURES.map((feature) => (
        <div className="setrow" key={feature.id}>
          <div className="setrow__label">
            <span className="setrow__name">{feature.label}</span>
            {feature.pendingStep ? (
              /* 未实现的原因**保持可见**（DESIGN.md §6.1：禁用要说明原因，且不能只靠悬停） */
              <span className="setrow__desc">将在 {feature.pendingStep} 生效</span>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={selected.includes(feature.id)}
            aria-label={feature.label}
            onClick={() => toggle(feature.id, !selected.includes(feature.id))}
          />
        </div>
      ))}
    </section>
  );
}
