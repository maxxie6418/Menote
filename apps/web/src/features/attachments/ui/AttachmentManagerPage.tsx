/**
 * 设置 › 数据管理 › 附件管理（M10-03 · M6 批 2c；设计稿 §4.2 的四块照做，不另起一版）。
 *
 * **这一屏回答三个问题**：一共占多少空间、哪些没人用了、能手动清掉多少。所以概览三数放最上面，
 * 列表给到「被多少条目引用」这一列（引用数是判断"能不能删"的唯一依据），主操作只有一个：清理孤儿。
 *
 * 三条实现取舍，都是有代价才这么定的：
 *
 * 1. **列表只取原图行**（`kind=original`）。缩略图是原图派生的第二行，让它单独占一行会让
 *    「附件总数」翻倍、同一张图在列表里出现两次。**代价**：占用空间只按原图算，不含缩略图——
 *    这条口径写在卡头 ⓘ 里，不藏着。
 * 2. **概览与筛选在客户端做，不另设接口**（设计 §4.3）。列表一次取到上限，筛选只切显示。
 *    取到的行数少于上限时**如实说**「只列出最近 N 个」，不拿截断的列表冒充全部。
 * 3. **状态按「有没有引用」判，不看 `orphaned_at`**。`orphaned_at` 只是清理那一轮打的标记，
 *    一个刚上传、还没跑过清理的文件会是 `null`——按它显示就会出现「在用 + 0 条引用」这种自相矛盾的行。
 *
 * 隐私：附件按明文存储、门禁只在正文层（功能拆解 M10-03），所以**隐私条目的附件照常显示文件名与缩略图**，
 * 这里不做任何加密过滤。
 */
import { useCallback, useEffect, useState } from "react";
import {
  ATTACHMENT_LIST_MAX_LIMIT,
  ATTACHMENT_ORPHAN_RETENTION_DAYS,
  type AttachmentListResponse,
  type AttachmentListRow,
  type AttachmentPurgePlan,
} from "@menote/shared";
import { Button, EmptyState, Pill } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { attachmentsApi } from "../../../data/api/endpoints";
import {
  UNNAMED_ATTACHMENT,
  attachmentUrl,
  formatBytes,
  isImageMime,
  orphanCountdownText,
  orphanGcConfirmText,
  orphanGcHint,
  planOrphanGc,
} from "../model";

type StateFilter = "all" | "active" | "orphaned";

const STATE_FILTERS: ReadonlyArray<{ id: StateFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "active", label: "在用" },
  { id: "orphaned", label: "孤儿" },
];

/** 状态按引用数判：`orphaned_at` 是标记不是事实（见文件头第 3 条） */
function stateOf(row: AttachmentListRow): Exclude<StateFilter, "all"> {
  return row.ref_count === 0 ? "orphaned" : "active";
}

function nameOf(row: AttachmentListRow): string {
  return row.filename?.trim() || UNNAMED_ATTACHMENT;
}

export function AttachmentManagerPage() {
  const [rows, setRows] = useState<AttachmentListRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StateFilter>("all");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 立即删除（v0.8.3）：预告与执行各一个状态，**各有各的弹窗** */
  const [purgePlan, setPurgePlan] = useState<AttachmentPurgePlan | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const load = useCallback(async (): Promise<AttachmentListResponse> => {
    return attachmentsApi.list({ kind: "original", limit: ATTACHMENT_LIST_MAX_LIMIT });
  }, []);

  const refresh = useCallback((): Promise<void> => {
    return Promise.all([load(), attachmentsApi.purgePlan()])
      .then(([result, plan]) => {
        setRows(result.attachments);
        setHasMore(result.has_more);
        setPurgePlan(plan);
        setError(null);
      })
      .catch((cause: unknown) => {
        // 失败时**保持错误可见**（DESIGN.md §5.4-2），不用会自动消失的提示承载
        setError(cause instanceof Error ? cause.message : "附件列表加载失败");
        setRows([]);
      });
  }, [load]);

  useEffect(() => {
    let alive = true;
    void Promise.all([load(), attachmentsApi.purgePlan()])
      .then(([result, plan]) => {
        if (!alive) return;
        setRows(result.attachments);
        setHasMore(result.has_more);
        setPurgePlan(plan);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "附件列表加载失败");
        setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  /*
    三次数下来回都作用在**至多 200 行**的列表上（取数时就把上限给定死了），所以直接算，
    不套 useMemo —— 那样只会多一处要跟 `rows ?? []` 的恒等性较劲的依赖。
  */
  const all = rows ?? [];
  const totalBytes = all.reduce((sum, row) => sum + row.size_bytes, 0);
  const orphanCount = all.filter((row) => stateOf(row) === "orphaned").length;
  const visible = filter === "all" ? all : all.filter((row) => stateOf(row) === filter);
  /*
    「点这个按钮到底会发生什么」在**客户端算**（`planOrphanGc`）：判定要的数据本来就在
    列表每一行的 `orphaned_at` 里，不必扩接口，也不必等服务端配合。

    `now` **在挂载时取一次**（而不是 render 体里直接 `Date.now()`——那是 render 期副作用，
    `react-hooks/purity` 会拦）。这一屏不是实时屏：倒计时本来就是"还有多少天"，
    跨过午夜重开页面自然刷新，不需要为它加一个每秒重渲染的 ticker。
  */
  const [now] = useState(() => Date.now());
  const gcPlan = planOrphanGc(all, now);
  /** 真的有事可做才可点：还有没标记的，或者有过期的可删 */
  const gcHasWork = gcPlan.unmarked > 0 || gcPlan.due > 0;

  async function runGc(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await attachmentsApi.gc();
      /*
        **三态分开说**。旧写法只有两句，且 `removed === 0` 时会说成「已标记 0 个…」
        ——一句自相矛盾的话，用户读到的就是"这按钮没用"。
      */
      if (result.removed > 0) {
        setNotice(
          result.marked > 0
            ? `已删除 ${result.removed} 个到期孤儿附件；另有 ${result.marked} 个开始 30 天倒计时，这次没有被删`
            : `已删除 ${result.removed} 个到期孤儿附件，空间已释放`,
        );
      } else if (result.marked > 0) {
        setNotice(`已标记 ${result.marked} 个孤儿附件；它们要满 30 天才会真正删除，现在还没有删掉任何文件`);
      } else {
        setNotice("没有需要清理的：要么没有孤儿，要么都在 30 天保留期里还没到期");
      }
      setConfirming(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  /** 立即删除：确认框里的数量**来自服务端预告**，不是界面自己数的（列表是截断的） */
  async function runPurge(): Promise<void> {
    if (purgeBusy) return;
    setPurgeBusy(true);
    try {
      const result = await attachmentsApi.purge();
      setNotice(
        result.removed > 0
          ? `已立即删除 ${result.removed} 个孤儿附件，释放 ${formatBytes(result.bytes)}`
          : "没有删掉任何附件：它们都已被条目重新引用",
      );
      setPurging(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请稍后重试");
    } finally {
      setPurgeBusy(false);
    }
  }

  return (
    <>
      <section className="setcard" aria-label="附件概览">
        <h3 className="setcard__title">
          附件概览
          <InfoHint label="附件概览说明">
            这里只统计**原图**：缩略图由原图派生、单独占一行会让同一张图出现两次，所以不计入总数与占用。
            孤儿指**没有任何条目引用**的附件；标为孤儿后还要满 30 天才会真正删除，期间重新被引用就不会被删。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">附件总数</span>
          </div>
          <span className="setrow__control">{all.length} 个</span>
        </div>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">占用空间</span>
          </div>
          <span className="setrow__control">{formatBytes(totalBytes)}</span>
        </div>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">孤儿附件</span>
          </div>
          <span className="setrow__control">{orphanCount} 个</span>
        </div>
        {/* 实时计数不许藏进 ⓘ（DESIGN.md §5.4-2），所以截断这件事直接说在页面上 */}
        {hasMore ? (
          <p className="hint-line">只列出最近 {all.length} 个附件，更早的请在正文里找。</p>
        ) : null}
      </section>

      <section className="setcard" aria-label="附件列表">
        <h3 className="setcard__title">
          附件列表
          <div className="segmented" role="group" aria-label="按状态筛选">
            {STATE_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="segmented__item"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </h3>

        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice !== null ? <p className="hint-line">{notice}</p> : null}

        {rows === null ? <p className="hint-line">正在读取…</p> : null}

        {/* 读失败时**不写空态**：那句「还没有附件」在读不出来的时候是假的（DESIGN.md §5.4-2） */}
        {rows !== null && error === null && visible.length === 0 && all.length === 0 && filter === "all" ? (
          <EmptyState title="还没有附件" hint="在笔记正文里粘贴或插入图片，文件会自动上传到这里。" />
        ) : null}

        {rows !== null && error === null && visible.length === 0 && (all.length > 0 || filter !== "all") ? (
          <EmptyState
            title="没有符合这个筛选的附件"
            hint="换一个筛选看看，或者回到「全部」。"
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                回到全部
              </Button>
            }
          />
        ) : null}

        {visible.map((row) => (
          <AttachmentRow key={row.id} row={row} now={now} />
        ))}
      </section>

      <section className="setcard" aria-label="清理孤儿附件">
        <h3 className="setcard__title">
          清理孤儿附件
          <InfoHint label="清理孤儿说明">
            清理分两步：先把**没有任何条目引用**的附件标为孤儿，再删掉其中已标满 {ATTACHMENT_ORPHAN_RETENTION_DAYS} 天的那些。
            保留期是给"删错了"留的补救窗口——期间重新被引用就不会被删。所以**第一次点只会开始倒计时，
            一个文件都不会少**。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">手动清理孤儿附件</span>
            {/* 没有可做的事时把原因**平铺**出来，不让禁用只靠悬停（DESIGN.md §6.1） */}
            <span className="setrow__desc">{orphanGcHint(gcPlan)}</span>
          </div>
          <span className="setrow__control">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || !gcHasWork}
              title={gcHasWork ? undefined : orphanGcHint(gcPlan)}
              onClick={() => setConfirming(true)}
            >
              {busy ? "清理中…" : "清理孤儿附件"}
            </Button>
          </span>
        </div>
        {/* 破坏性后果平铺：置灰/可点时都要说清「这次到底会不会删文件」 */}
        <p className="hint-line">
          {gcPlan.due > 0
            ? `本次会永久删除 ${gcPlan.due} 个附件，删除不可撤销。`
            : `本次不会删除任何文件——保留期为 ${ATTACHMENT_ORPHAN_RETENTION_DAYS} 天，到期后由每日维护自动清理，也可以再点一次。`}
        </p>
      </section>

      <section className="setcard" aria-label="立即删除孤儿附件">
        <h3 className="setcard__title">
          不等了，现在就删
          <InfoHint label="立即删除说明">
            走的是另一条路：跳过那 {ATTACHMENT_ORPHAN_RETENTION_DAYS} 天保留期，
            把**没有任何条目引用**的附件立刻删掉。保留期是给「删错了」留的补救窗口——
            用这条路就等于主动放弃它，**删掉的东西找不回来**。
            正在被引用的附件仍然一个都不会动。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">立即删除全部孤儿附件</span>
            {/* 禁用与否都说清数量与后果，不让禁用只靠悬停（DESIGN.md §6.1） */}
            <span className="setrow__desc">
              {purgePlan === null
                ? "正在数…"
                : purgePlan.count === 0
                  ? "当前没有可删除的孤儿附件"
                  : `将立即删除 ${purgePlan.count} 个（${formatBytes(purgePlan.bytes)}）${
                      purgePlan.withinRetention > 0
                        ? `，其中 ${purgePlan.withinRetention} 个还在保留期里`
                        : ""
                    }`}
            </span>
          </div>
          <span className="setrow__control">
            <Button
              variant="danger"
              size="sm"
              disabled={purgeBusy || purgePlan === null || purgePlan.count === 0}
              title={purgePlan === null || purgePlan.count === 0 ? "当前没有可删除的孤儿附件" : undefined}
              onClick={() => setPurging(true)}
            >
              {purgeBusy ? "删除中…" : "立即删除"}
            </Button>
          </span>
        </div>
      </section>

      <Modal
        open={confirming}
        title="清理孤儿附件"
        desc={orphanGcConfirmText(gcPlan)}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void runGc()}>
              {busy ? "清理中…" : gcPlan.due > 0 ? `确认删除 ${gcPlan.due} 个` : `确认标记 ${gcPlan.unmarked} 个`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </>
        }
      >
        <p className="hint-line">
          正在使用的附件不会被删：只有引用数为 0 的才会被标记。
          已标记的到满 {ATTACHMENT_ORPHAN_RETENTION_DAYS} 天后会被自动清理，不必再手动点。
        </p>
      </Modal>
      {/* 立即删除：**独立**的确认弹窗，不复用上面那个 */}
      <Modal
        open={purging}
        title="立即删除全部孤儿附件"
        desc={
          purgePlan === null
            ? "正在数…"
            : purgePlan.count === 0
              ? "当前没有可删除的孤儿附件。"
              : `将永久删除 ${purgePlan.count} 个附件，释放 ${formatBytes(purgePlan.bytes)}。${
                  purgePlan.withinRetention > 0
                    ? `其中 ${purgePlan.withinRetention} 个还在 ${ATTACHMENT_ORPHAN_RETENTION_DAYS} 天保留期里${
                        purgePlan.count - purgePlan.withinRetention === 0 ? "，也就是说" : "，另有 "
                      }${purgePlan.count - purgePlan.withinRetention} 个已经过期但同样要一起删。`
                    : "它们都已经过了保留期。"
                  }**删除不可撤销，找不回来。`
        }
        onClose={() => setPurging(false)}
        footer={
          <>
            <Button variant="danger" size="sm" disabled={purgeBusy} onClick={() => void runPurge()}>
              {purgeBusy ? "删除中…" : `确认删除 ${purgePlan?.count ?? 0} 个`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPurging(false)}>
              取消
            </Button>
          </>
        }
      >
        <p className="hint-line">
          正在使用的附件不会被删：只有引用数为 0 的才会被删掉。R2 上的文件由后台清理队列稍后删除。
        </p>
        <p className="hint-line">
          如果你只是想腾点空间，30 天保留期那条路就够了——它给「删错了」留了补救窗口。
        </p>
      </Modal>
    </>
  );
}

/**
 * 列表一行：缩略图 + 文件名 / 类型 · 尺寸 · 大小 · 引用数，右侧一个状态胶囊。
 *
 * **没有缩略图就回退文件图标**（设计 §4.2）：非图片本来就没有缩略图，图片的缩略图也可能没生成成功，
 * 两种都走 `onError` 换图标，不留破图。
 *
 * **孤儿的保留期倒计时就写在这一行里**（v0.8.2）：`orphaned_at` 一直在响应里却从没被用过，
 * 于是点完「清理」之后界面**一个像素都没变**——用户只能反复点，最后判定按钮坏了。
 * 把"已标记 N 天 · M 天后清理"摆出来，"点了没反应"才变成"看到在倒计时"。
 */
function AttachmentRow({ row, now }: { row: AttachmentListRow; now: number }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const state = stateOf(row);
  const dimensions =
    row.width != null && row.height != null ? `${row.width}×${row.height}` : "尺寸未知";
  const countdown = orphanCountdownText(row, now);

  return (
    <div className="setrow">
      <div className="setrow__label">
        {/* `.attachment-link` 就是「小方块 + 文字 + gap」那一行版式（缩略图 28px 走行内尺寸，不新增 CSS） */}
        <span className="attachment-link">
          {isImageMime(row.mime, nameOf(row)) && !thumbFailed ? (
            <img
              src={attachmentUrl(row.sha256, { thumb: true })}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: 28, height: 28, objectFit: "cover", borderRadius: "var(--radius)" }}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <Icon name={isImageMime(row.mime, nameOf(row)) ? "image" : "note"} size={20} />
          )}
          <span className="setrow__name">{nameOf(row)}</span>
        </span>
        <span className="setrow__desc">
          {row.mime ?? "类型未知"} · {dimensions} · {formatBytes(row.size_bytes)} · 被 {row.ref_count} 条
          条目引用
        </span>
        {countdown !== null ? <span className="setrow__desc">{countdown}</span> : null}
      </div>
      <div className="setrow__control">
        <Pill tone={state === "active" ? "ok" : "neutral"}>{state === "active" ? "在用" : "孤儿"}</Pill>
      </div>
    </div>
  );
}
