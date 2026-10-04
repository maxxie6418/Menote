/**
 * 设置 › 备份 ·「外部备份目标」卡片（M7 第 4 项 批 1；设计 §四、§六）。
 *
 * 这一屏装的是**目标的管理**，不是推送的执行——执行在批 3 的 Cron 状态机里。
 * 用户在这里能做的：添加、编辑、启停、测连接、删除。
 *
 * ## 几条照 DESIGN.md 落的口径
 *
 * - **删除走行内二次确认**（用户 2026-10-03 在 MCP 那屏定的调子，与 `MySharesPage` 同款）：
 *   行内确认时上下文就在眼前。**后果必须平铺**：删目标只清本机账本、远端文件一个都不动。
 * - **读失败不写空态**（§6.1）：读不出来的时候"还没有目标"是假的。
 * - **失败原因平铺**（§5.4-2）：`last_error` 与测连接的结果都不进 ⓘ、不靠 Toast 承载，
 *   因为它们要留到用户下一次打开这一屏时还在。
 * - **零新增 CSS**：全部用既有 `setcard` / `setrow` / `toggle` / `pill` / `hint-line` / `empty`。
 */
import { useCallback, useEffect, useState } from "react";
import type { BackupTarget } from "@menote/shared";
import { Button, EmptyState, Pill } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { useTicker } from "../../../app/ui/useTicker";
import { backupTargetsApi } from "../../../data/api/backup-targets";
import { KIND_LABEL, POLICY_LABEL, SCHEDULE_LABEL, lastRunText, quotaNotice } from "../model";
import { BackupTargetDialog } from "./BackupTargetDialog";
import { PushProgressDialog } from "./PushProgressDialog";

/** 一次测连接 / 推一次的结果，按目标 id 存：同一屏上多个目标各自报自己的，互不覆盖 */
type TestResults = Readonly<Record<string, { ok: boolean; message: string }>>;

export function BackupTargetsCard() {
  const [targets, setTargets] = useState<BackupTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  /** 正在跑「推一次」的目标（进度弹窗据此挂载） */
  const [pushing, setPushing] = useState<BackupTarget | null>(null);
  const [results, setResults] = useState<TestResults>({});
  const [runText, setRunText] = useState<Readonly<Record<string, string>>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<BackupTarget | null | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setTargets(await backupTargetsApi.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "目标列表加载失败");
      setTargets([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* 「最近成功 3 小时前」这类相对时间靠它保持新鲜（`McpSettingsPage` 同款） */
  const now = useTicker(targets !== null && targets.length > 0);

  async function toggle(target: BackupTarget): Promise<void> {
    setBusy(true);
    try {
      await backupTargetsApi.update(target.id, { enabled: !target.enabled });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "切换失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function runTest(target: BackupTarget): Promise<void> {
    setTesting(target.id);
    // 先把这枚的旧结果抹掉，否则重测期间会同时显示"上次失败"和"测试中"，两句话互相打架
    setResults((current) => {
      const next: Record<string, { ok: boolean; message: string }> = {};
      for (const [key, value] of Object.entries(current)) {
        if (key !== target.id) next[key] = value;
      }
      return next;
    });
    try {
      // 不送 secret：让服务端用库里已存的那份，且不回显、不外传
      const result = await backupTargetsApi.test(target.id);
      setResults((current) => ({ ...current, [target.id]: result }));
    } catch (cause) {
      setResults((current) => ({
        ...current,
        [target.id]: { ok: false, message: cause instanceof Error ? cause.message : "连接失败，请稍后重试" },
      }));
    } finally {
      setTesting(null);
    }
  }

  /** 「推一次」：打开进度弹窗，由它循环调服务端那套状态机（一轮一批） */
  function runOnce(target: BackupTarget): void {
    setPushing(target);
  }

  async function remove(target: BackupTarget): Promise<void> {
    setBusy(true);
    try {
      await backupTargetsApi.remove(target.id);
      setPendingDelete(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="setcard" aria-label="外部备份目标">
        <h3 className="setcard__title">
          外部备份目标
          <InfoHint label="这是什么">
            把备份定时推到你的 WebDAV 或 S3 存储，不经过这台服务器的中转——
            Worker 每轮最多推 40 个文件，推不完下一轮接着推。加密条目的密文原样推出去，
            但<strong>不会</strong>推任何密钥，所以那份备份仍要按敏感文件对待。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span>添加一个远端，备份会自动推过去</span>
          </div>
          <div className="setrow__control">
            <Button variant="primary" size="sm" onClick={() => setEditing(null)}>
              添加目标
            </Button>
          </div>
        </div>

        {error !== null ? (
          <div role="alert" className="hint-line">
            <span>{error}</span>
          </div>
        ) : null}

        {targets === null ? <p className="hint-line">正在读取…</p> : null}

        {/* 读失败时 targets 会被置成 []，但 error 非空——不写空态（DESIGN.md §6.1） */}
        {targets !== null && error === null && targets.length === 0 ? (
          <EmptyState
            title="还没有备份目标"
            hint="加一个 WebDAV 或 S3 存储，备份就会定时推进去。也可以先不定时，随时用上面的「导出备份」手动存一份。"
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing(null)}>
                添加目标
              </Button>
            }
          />
        ) : null}

        {targets?.map((target) => {
          const result = results[target.id];
          const confirming = pendingDelete === target.id;
          return (
            <div key={target.id} className="setcard" style={target.enabled ? undefined : { opacity: 0.7 }}>
              <div className="setrow">
                <div className="setrow__label">
                  <strong>{target.label}</strong>
                </div>
                <div className="setrow__control">
                  <Pill tone={target.last_result === "failed" ? "err" : target.last_result === "ok" ? "ok" : "neutral"}>
                    {target.enabled ? KIND_LABEL[target.kind] : "已停用"}
                  </Pill>
                </div>
              </div>

              <p className="hint-line">{target.endpoint}</p>
              <p className="hint-line">
                {SCHEDULE_LABEL[target.schedule]} · 远端{POLICY_LABEL[target.delete_policy]} ·{" "}
                {lastRunText(target, now)}
              </p>

              {/* 失败原因平铺，且留到下次打开还在（DESIGN.md §5.4-2） */}
              {target.last_error !== null ? (
                <p className="hint-line">上次失败：{target.last_error}</p>
              ) : null}
              {result !== undefined ? (
                <p className="hint-line">
                  {result.ok ? "连接正常。" : `连接失败：${result.message}`}
                </p>
              ) : null}
              {/* 「推一次」的结果留在这一行上，不靠会自动消失的 Toast（DESIGN.md §5.4-2） */}
              {runText[target.id] !== undefined ? <p className="hint-line">{runText[target.id]}</p> : null}

              <div className="setrow">
                <div className="setrow__label">
                  <span>启用</span>
                </div>
                <div className="setrow__control">
                  <button
                    type="button"
                    role="switch"
                    className="toggle"
                    aria-checked={target.enabled}
                    aria-label={`启用「${target.label}」的定时备份`}
                    disabled={busy}
                    onClick={() => void toggle(target)}
                  />
                </div>
              </div>

              <div className="setrow">
                <div className="setrow__control">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={testing === target.id}
                    onClick={() => void runTest(target)}
                  >
                    {testing === target.id ? "测试中" : "测连接"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(target)}>
                    编辑
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => runOnce(target)}>
                    推一次
                  </Button>
                  {confirming ? (
                    <>
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove(target)}>
                        确认删除
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setPendingDelete(target.id)}>
                      删除
                    </Button>
                  )}
                </div>
              </div>

              {/* 后果平铺：不藏进 InfoHint */}
              {confirming ? (
                <p className="hint-line">
                  删除后这个目标不再推送。<strong>远端已经推上去的文件一个都不会动</strong>
                  ，它们仍在那个存储里；这里只是不再往那儿推了。
                </p>
              ) : null}
            </div>
          );
        })}

        {targets !== null && targets.length > 0 ? (
          <p className="hint-line">{quotaNotice()}</p>
        ) : null}
      </section>

      {/* `key` 让每次打开都是一次干净挂载：表单状态随挂载初始化，不靠 effect 重置 */}
      {editing !== undefined ? (
        <BackupTargetDialog
          key={editing === null ? "create" : `edit-${editing.id}`}
          open
          target={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => void refresh()}
          create={backupTargetsApi.create}
          update={backupTargetsApi.update}
        />
      ) : null}
      {/* 进度弹窗自己循环调服务端（界面稿 v1 §三-1）。`key` 让每次开都是一次干净挂载 */}
      {pushing !== null ? (
        <PushProgressDialog
          key={pushing.id}
          target={pushing}
          onClose={() => setPushing(null)}
          onFinished={(text) => {
            // 结果留在目标行上：关掉弹窗也还能看到上次推了什么
            setRunText((current) => ({ ...current, [pushing.id]: text }));
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}
