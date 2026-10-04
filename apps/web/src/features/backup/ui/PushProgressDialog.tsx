/**
 * 推送进度弹窗（M7 第 4 项补做；界面稿 `docs/modules/Menote-M7-备份推送进度条-界面稿-v1.md` v1）。
 *
 * 一轮 = 一个批次（架构 §14.3：免费版**外部**子请求 50 / invocation），所以**进度条是
 * 浏览器反复调 `POST /api/backup/targets/:id/run` 累出来的**，不是服务端一口气推完。
 *
 * ## 三条照稿落的口径
 *
 * 1. **循环有上限**（`MAX_ROUNDS`）。到上限就停并如实说"还剩多少没推完"——
 *    **不能让"用户一直在打字所以推不完"变成一个停不下来的循环**。
 * 2. **中断不丢进度**：游标在 D1（`user_backup_targets.cursor_seq`），关掉弹窗 / 关掉页面
 *    都不影响，下次点「推一次」从游标接着推。所以**这里允许随手关掉**
 *    （不设 `dismissable={false}`——那是不该让用户做的事），且要**把这句话说出来**，
 *    否则用户会以为关掉就白推了。
 * 3. **「推了一部分」不是失败**。一轮一批的硬限额下它必然发生，四个终态分开说
 *    （跑完 / 部分 / 失败 / 本来就是最新的），不合并成"成功 / 失败"两个。
 *
 * **零新增视觉语言**：进度条只用现成令牌（`--panel-2` / `--primary-grad` / `--radius-sm`），
 * 深色主题自动成立；**不做过渡动画**（每轮只有几百毫秒到几秒，过渡既看不清又每轮重置一次）。
 */
import { useEffect, useRef, useState } from "react";
import type { BackupTarget } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { backupTargetsApi } from "../../../data/api/backup-targets";
import {
  accumulateRun,
  initialRunState,
  progressOf,
  progressText,
  pushRunText,
  type PushRunState,
} from "../model";

/**
 * 循环上限。
 *
 * 40 个 / 轮 × 50 轮 = 最多 2000 个文件一轮推完，家庭量级绰绰有余。
 * **它存在的唯一理由是"用户一直在打字"**——那种情况下应该停下来把"还剩多少"说清楚，
 * 而不是让浏览器一直打服务端。
 */
export const MAX_ROUNDS = 50;

export interface PushProgressDialogProps {
  target: BackupTarget;
  onClose: () => void;
  /** 终态一句话；**外层把它留在目标行上**，关掉弹窗也还能看到上次推了什么 */
  onFinished: (text: string) => void;
}

export function PushProgressDialog({ target, onClose, onFinished }: PushProgressDialogProps) {
  const [state, setState] = useState<PushRunState>(initialRunState);
  /** 用户主动关掉时置位：用来把"关掉也没关系"那句话加进文案 */
  const [interrupted, setInterrupted] = useState(false);
  /** 防止 unmount 之后还在 setState（关掉弹窗后循环要立刻停） */
  const aliveRef = useRef(true);
  /**
   * 循环**只跑一次**（每次挂载一轮）。
   *
   * 这里刻意不用 `useEffect(() => { run() }, [run])`：`onFinished` 是调用方内联传进来的
   * 箭头函数，父组件每渲染一次它就是新引用 → `useCallback` 产出的 `run` 每渲染都变 →
   * effect 每渲染重跑 → 一次 `setState` 触发一次重渲染 → **循环失控**（实测一次点击发了
   * 三万八千个请求）。改用 ref 守卫：挂载启动一次，之后与渲染次数无关。
   */
  const startedRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      let current = initialRunState();
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (!aliveRef.current) return;
        const result = await backupTargetsApi.run(target.id);
        if (!aliveRef.current) return;
        current = accumulateRun(current, result);
        setState(current);
        if (current.phase !== "running") break;
      }
      if (current.phase === "running") setInterrupted(true);
      onFinished(pushRunText(current, current.phase === "running"));
    })();
    // `target.id` 是这个循环真正依赖的东西；`onFinished` 故意不进依赖（见 startedRef 的说明）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  const finished = state.phase !== "running";
  const percent = Math.round(progressOf(state) * 100);

  return (
    <Modal
      open
      title={`推送到「${target.label}」`}
      // **允许随手关掉**：游标在服务端，关掉不丢进度（口径 2）
      onClose={() => {
        setInterrupted(true);
        onClose();
      }}
      footer={
        finished ? (
          <Button variant="primary" size="sm" onClick={onClose}>
            关掉
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            先关掉（下次接着推）
          </Button>
        )
      }
    >
      {/*
        进度条 + 数字行。**数字必须有**——DESIGN.md §3.2「语义色不得单独表意」：
        颜色只是辅助，比例得能被读出来。`role="progressbar"` + aria 值让读屏也能报。
      */}
      <div className="setrow">
        <div className="setrow__label">
          <span>
            进度
            <InfoHint label="为什么是一轮一批">
              浏览器每次请求服务端推一批（外部子请求有硬上限），这个弹窗会自动接着推下一批。
              关掉也不丢——断点记在服务器上，下次点「推一次」从那里接着来。
            </InfoHint>
          </span>
        </div>
        <div className="setrow__control">
          <span>{progressText(state)}</span>
        </div>
      </div>

      <div
        className="pushbar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="推送进度"
      >
        <div className="pushbar__fill" style={{ width: `${percent}%` }} />
      </div>

      {/* 结果三态必须平铺（DESIGN.md §5.4-2）：不用会自动消失的 Toast 承载 */}
      {state.phase === "failed" ? (
        <div className="banner banner--warn" role="alert">
          <span>{pushRunText(state, interrupted)}</span>
        </div>
      ) : (
        <p className="hint-line">{pushRunText(state, interrupted || !finished)}</p>
      )}
    </Modal>
  );
}
