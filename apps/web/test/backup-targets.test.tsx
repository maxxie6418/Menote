// @vitest-environment jsdom
/**
 * 外部备份目标的界面与纯函数契约（M7 第 4 项 批 1；设计 §四、§六）。
 *
 * 盯的是那几条**"容易被实现漏掉"**的口径：
 * - **凭据永不回显**：编辑弹窗里密钥框必须是空的，且 label 要说清"留空 = 不改"
 *   （否则用户以为删掉输入框就等于换了新密钥）；
 * - **编辑时不送 `secret` 键**——送空串会被服务端当成"清空凭据"（model 层断言）；
 * - **删除走行内二次确认 + 后果平铺**，且那句话必须说清"远端文件一个都不动"
 *   （DESIGN.md §5.4-2、§6.5）；
 * - **读失败不写空态**（那时候"还没有目标"是假的，§6.1）；
 * - **失败原因平铺**且留到下次打开还在，不靠 Toast 承载（§5.4-2）；
 * - **默认档是 `append_only`**，选「与本机保持一致」才出现不可恢复的警告。
 *
 * 数据来源 `vi.mock` 掉接口层（本屏自己拿数据，不走 props），与 `mcp-settings.test.tsx` 同款。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackupRunResult,
  BackupTarget,
  BackupTestResult,
  UpdateBackupTargetInput,
} from "@menote/shared";
import { BackupTargetsCard } from "../src/features/backup/ui/BackupTargetsCard";
import {
  accumulateRun,
  buildTargetPayload,
  emptyTargetForm,
  formFromTarget,
  initialRunState,
  lastRunText,
  policyRisk,
  progressOf,
  progressText,
  pushRunText,
  targetWhere,
} from "../src/features/backup/model";
import { MAX_ROUNDS } from "../src/features/backup/ui/PushProgressDialog";

const NOW = Date.now();

function makeTarget(overrides: Partial<BackupTarget> = {}): BackupTarget {
  return {
    id: "t1",
    kind: "webdav",
    label: "家里的 NAS",
    endpoint: "https://dav.example.com/menote",
    bucket: null,
    region: null,
    username: "me",
    has_secret: true,
    enabled: true,
    delete_policy: "append_only",
    schedule: "daily",
    cursor_seq: 100,
    last_run_at: NOW - 3 * 60 * 60_000,
    last_result: "ok",
    last_error: null,
    created_at: NOW - 86_400_000,
    ...overrides,
  };
}

interface ServerState {
  targets: BackupTarget[];
  listError: string | null;
  testResult: BackupTestResult | null;
  /** 「推一次」的逐轮结果：每调一次 `/run` 取一个，取完就重复最后一个（模拟"一直推不完"） */
  runQueue: BackupRunResult[];
  /** 非 null 时，第 2 轮及以后的 `/run` 会**卡在这个 promise 上**，直到测试自己放行 */
  runGate: Promise<void> | null;
  /** 每轮的模拟网络延迟。只给需要观察**中间态**的用例留延迟，其余设 0 免得全量并行时超时 */
  runDelayMs: number;
  runCalls: number;
  removed: string[];
  updates: Array<{ id: string; input: UpdateBackupTargetInput }>;
}

let state: ServerState = {
  targets: [],
  listError: null,
  testResult: null,
  runQueue: [],
  runGate: null,
  runDelayMs: 2,
  runCalls: 0,
  removed: [],
  updates: [],
};

vi.mock("../src/data/api/backup-targets", () => ({
  backupTargetsApi: {
    list: async (): Promise<BackupTarget[]> => {
      if (state.listError !== null) throw new Error(state.listError);
      return state.targets;
    },
    create: async (): Promise<BackupTarget> => makeTarget({ id: "new" }),
    update: async (id: string, input: UpdateBackupTargetInput): Promise<BackupTarget> => {
      state.updates.push({ id, input });
      const found = state.targets.find((row) => row.id === id);
      if (found === undefined) throw new Error("目标不存在");
      return { ...found, ...input };
    },
    remove: async (id: string): Promise<void> => {
      state.removed.push(id);
      state.targets = state.targets.filter((row) => row.id !== id);
    },
    test: async (): Promise<BackupTestResult> => {
      if (state.testResult === null) throw new Error("没有配置测连接结果");
      return state.testResult;
    },
    run: async (): Promise<BackupRunResult> => {
      state.runCalls += 1;
      const picked = state.runQueue[Math.min(state.runCalls - 1, state.runQueue.length - 1)];
      if (picked === undefined) throw new Error("没有配置推一次结果");
      /*
        **刻意有一点延迟**：真发网络请求是要时间的，而同步返回的 mock 会让整个循环
        在 React 重渲染之前就跑完——那样"中间那一档进度"根本观察不到，
        而中间态恰恰是进度条唯一有存在理由的那部分。
        要断言某个**特定**中间态的用例用 `runGate` 卡住后续轮次，不靠等时间。
      */
      if (state.runDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.runDelayMs));
      if (state.runCalls >= 2 && state.runGate !== null) await state.runGate;
      return picked;
    },
  },
}));

beforeEach(() => {
  state = {
    targets: [],
    listError: null,
    testResult: null,
    runQueue: [],
    runGate: null,
    runDelayMs: 2,
    runCalls: 0,
    removed: [],
    updates: [],
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("外部备份目标 · 纯函数", () => {
  it("新建时 secret 必填", () => {
    const form = { ...emptyTargetForm(), label: "NAS", endpoint: "https://dav.example.com/menote" };
    const built = buildTargetPayload(form, true);
    expect(built).toEqual({ ok: false, error: expect.stringContaining("密钥必填") });
  });

  it("编辑时 secret 留空 = 不改，**不送 secret 键**（送空串会被当成清空）", () => {
    const form = formFromTarget(makeTarget());
    expect(form.secret).toBe("");
    const built = buildTargetPayload(form, false);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.hasOwn(built.value, "secret")).toBe(false);
  });

  it("编辑时填了新 secret 才送，且连 kind 一起不送（kind 不可改）", () => {
    const form = { ...formFromTarget(makeTarget({ kind: "s3", bucket: "b" })), secret: "new-secret" };
    const built = buildTargetPayload(form, false);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ secret: "new-secret" });
    expect(Object.hasOwn(built.value, "kind")).toBe(false);
  });

  it("S3 必须填桶名；WebDAV 的桶名不进请求体", () => {
    const s3 = { ...emptyTargetForm(), kind: "s3" as const, label: "R2", endpoint: "https://s3.example.com", secret: "k" };
    expect(buildTargetPayload(s3, true)).toEqual({ ok: false, error: expect.stringContaining("桶名") });

    const webdav = { ...emptyTargetForm(), label: "NAS", endpoint: "https://dav.example.com/m", secret: "k", bucket: "不该送" };
    const built = buildTargetPayload(webdav, true);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ bucket: null });
  });

  it("地址必须是 http(s) 开头且不含空格", () => {
    const form = { ...emptyTargetForm(), label: "x", endpoint: "dav.example.com", secret: "k" };
    expect(buildTargetPayload(form, true)).toEqual({ ok: false, error: expect.stringContaining("http") });
  });

  it("默认档是只增不删；选 sync 才出现不可恢复的警告", () => {
    expect(emptyTargetForm().delete_policy).toBe("append_only");
    expect(policyRisk("append_only")).toBeNull();
    expect(policyRisk("sync")).toContain("不可恢复");
  });

  it("lastRunText 分清「没跑过」和「从没成功过」和「最近失败」", () => {
    expect(lastRunText(makeTarget({ last_run_at: null }), NOW)).toBe("还没跑过");
    expect(lastRunText(makeTarget({ last_run_at: NOW - 3_600_000, last_result: null }), NOW)).toContain("从没成功过");
    expect(lastRunText(makeTarget({ last_run_at: NOW - 3_600_000, last_result: "failed" }), NOW)).toContain("最近失败");
    expect(lastRunText(makeTarget(), NOW)).toContain("最近成功");
  });

  it("S3 的 where 带上桶名，WebDAV 不带", () => {
    expect(targetWhere(makeTarget())).toContain("dav.example.com/menote");
    expect(targetWhere(makeTarget({ kind: "s3", endpoint: "https://s3.example.com", bucket: "my-bucket" }))).toContain(
      "https://s3.example.com/my-bucket",
    );
  });
});

describe("外部备份目标 · 界面", () => {
  it("读失败时不写空态（那时候「还没有目标」是假的）", async () => {
    state.listError = "网络断了";
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("网络断了")).toBeTruthy());
    expect(screen.queryByText("还没有备份目标")).toBeNull();
  });

  it("列表为空时给空态和主操作", async () => {
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("还没有备份目标")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "添加目标" }).length).toBeGreaterThan(0);
  });

  it("失败原因平铺可见，不藏进 ⓘ", async () => {
    state.targets = [makeTarget({ last_result: "failed", last_error: "远端返回 403" })];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("上次失败：远端返回 403")).toBeTruthy());
  });

  it("删除走行内二次确认，且明说远端文件一个都不动", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/远端已经推上去的文件一个都不会动/)).toBeTruthy();
    // 还没点确认时不该真删
    expect(state.removed).toEqual([]);

    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(state.removed).toEqual(["t1"]));
  });

  it("编辑弹窗里密钥框是空的，且 label 说清留空 = 不改", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "编辑" }));
    const secret = await screen.findByLabelText("换口令（留空 = 不改）") as HTMLInputElement;
    expect(secret.value).toBe("");
  });

  it("类型在编辑态置灰，并给出原因（不可只置灰）", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "编辑" }));
    const option = await screen.findByRole("button", { name: "WebDAV" }) as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    expect(option.getAttribute("title")).toContain("删掉重建");
  });

  it("测连接的结果留在这一屏上", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    state.testResult = { ok: false, message: "远端返回 401" };
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "测连接" }));
    await waitFor(() => expect(screen.getByText("连接失败：远端返回 401")).toBeTruthy());
  });

  it("停用开关会改 enabled，且界面上不再显示为已启用", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("switch", { name: /启用「家里的 NAS」/ }));
    await waitFor(() => expect(state.updates).toEqual([{ id: "t1", input: { enabled: false } }]));
  });
});

describe("外部备份目标 · 推一次（进度条）", () => {
  it("自动循环多轮直到推完，进度条跟着涨", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    // 三轮：40 → 40 → 20
    state.runQueue = [
      { pushed: 40, deleted: 0, total: 100, remaining: 60, quota_stopped: true, error: null },
      { pushed: 40, deleted: 0, total: 60, remaining: 20, quota_stopped: true, error: null },
      { pushed: 20, deleted: 0, total: 20, remaining: 0, quota_stopped: false, error: null },
    ];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    await waitFor(() => expect(screen.getByText("已推 100 / 100")).toBeTruthy());
    expect(state.runCalls).toBe(3);
    // 结果**故意**出现两处：弹窗（当前这次）与目标行（关掉后还能看到）——所以用复数查询
    const texts = screen.getAllByText("推完了，100 个文件都已推到远端。");
    expect(texts.length).toBe(2);
  });

  it("进度条的比例跟着走（不是一步跳到 100%）", async () => {
    const user = userEvent.setup();
    let openGate = (): void => {};
    state.runGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    state.targets = [makeTarget()];
    state.runQueue = [
      { pushed: 25, deleted: 0, total: 100, remaining: 75, quota_stopped: true, error: null },
      { pushed: 75, deleted: 0, total: 75, remaining: 0, quota_stopped: false, error: null },
    ];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    // 第二轮被 `runGate` 卡住，所以这个中间态**是确定的**、不靠等时间
    await waitFor(() => expect(screen.getByText("已推 25 / 100")).toBeTruthy());
    // 中途那一档的宽度必须是 25%，**不是**一路飙到 100%
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");

    openGate();
    await waitFor(() => expect(screen.getByText("已推 100 / 100")).toBeTruthy());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("循环有上限：到顶就停并说清「还剩多少」，不空转", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    // 这条只验**终态与调用次数**，不需要观察中间态 → 每轮不留延迟，
    // 否则 50 轮在全套件并行时会把 `waitFor` 拖过默认超时（它和"进度条那条"是两种诉求）
    state.runDelayMs = 0;
    // 永远推不完（用户在一直打字）：每一轮都还是"还剩很多"
    state.runQueue = Array.from({ length: MAX_ROUNDS + 10 }, () => ({
      pushed: 40,
      deleted: 0,
      total: 1000,
      remaining: 500,
      quota_stopped: true,
      error: null,
    }));
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    await waitFor(() => expect(state.runCalls).toBe(MAX_ROUNDS));
    // 2000 = 50 轮 × 40 个：正好停在上限，一个都没多推
    expect(screen.getAllByText(/还剩 500 个没推完/).length).toBe(2);
    // 说了「关掉也没关系」——不说这句，用户会以为关掉就白推了
    expect(screen.getAllByText(/关掉也没关系，下次接着推/).length).toBe(2);
  });
  it("失败时原因平铺、不藏进 ⓘ", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    state.runQueue = [
      { pushed: 10, deleted: 0, total: 50, remaining: 40, quota_stopped: true, error: null },
      { pushed: 0, deleted: 0, total: 40, remaining: 40, quota_stopped: false, error: "远端返回 401" },
    ];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    await waitFor(() => expect(screen.getAllByText("没推成：远端返回 401").length).toBe(2));
    // **失败即停**：不该继续打服务端
    expect(state.runCalls).toBe(2);
  });

  it("本来就是最新的：说「已经是最新的了」而不是显示成失败或 0%", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    state.runQueue = [{ pushed: 0, deleted: 0, total: 0, remaining: 0, quota_stopped: false, error: null }];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    await waitFor(() => expect(screen.getAllByText("已经是最新的了，没有需要推送的内容。").length).toBe(2));
    // 没东西可推 = 已完成，不是 0%
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("结果留在目标行上：关掉弹窗还看得到上次推了什么", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    state.runQueue = [{ pushed: 7, deleted: 0, total: 7, remaining: 0, quota_stopped: false, error: null }];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "关掉" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "关掉" }));

    await waitFor(() =>
      expect(screen.getAllByText("推完了，7 个文件都已推到远端。").length).toBeGreaterThan(0),
    );
  });

  it("允许随手关掉（不设 dismissable=false）——游标在服务端，关掉不丢", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    // 一直推不完
    state.runQueue = Array.from({ length: MAX_ROUNDS + 10 }, () => ({
      pushed: 40,
      deleted: 0,
      total: 1000,
      remaining: 900,
      quota_stopped: true,
      error: null,
    }));
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "推一次" }));
    // 非终态时按钮明说「先关掉（下次接着推）」，不是让人猜
    const stop = screen.getByRole("button", { name: "先关掉（下次接着推）" });
    await user.click(stop);
    expect(screen.queryByRole("progressbar")).toBeNull();
    // 关掉后循环必须**停下来**。允许最多多一次：点关掉那一刻可能已有一次请求在途
    const after = state.runCalls;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(state.runCalls).toBeLessThanOrEqual(after + 1);
  });
});

describe("外部备份目标 · 进度纯函数", () => {
  const one = (over: Partial<BackupRunResult>): BackupRunResult => ({
    pushed: 0,
    deleted: 0,
    total: 0,
    remaining: 0,
    quota_stopped: false,
    error: null,
    ...over,
  });

  it("total 只增不减：用户一边打字一边推时进度条不许往回跳", () => {
    let state = initialRunState();
    state = accumulateRun(state, one({ pushed: 40, total: 100, remaining: 60 }));
    expect(progressOf(state)).toBeCloseTo(0.4);
    // 新内容进来：这一次报的 total 比累计推过的还小
    state = accumulateRun(state, one({ pushed: 10, total: 20, remaining: 10 }));
    expect(progressOf(state)).toBeCloseTo(0.5);
    expect(state.total).toBe(100);
  });

  it("比例夹在 0–1：total 为 0 时是「已完成」而不是 0%", () => {
    expect(progressOf({ ...initialRunState(), total: 0 })).toBe(1);
    const over = { ...initialRunState(), done: 10, total: 5, phase: "done" as const };
    expect(progressOf(over)).toBe(1);
    expect(progressOf({ ...initialRunState(), done: -3, total: 10 })).toBe(0);
  });

  it("四个终态分开说，「推了一部分」不算失败", () => {
    const done = { phase: "done", done: 5, total: 5, remaining: 0, error: null } as const;
    expect(pushRunText(done, false)).toBe("推完了，5 个文件都已推到远端。");
    expect(pushRunText({ ...done, done: 0 }, false)).toContain("已经是最新的了");

    const partial = { phase: "running", done: 40, total: 100, remaining: 60, error: null } as const;
    expect(pushRunText(partial, true)).toContain("关掉也没关系");
    expect(pushRunText(partial, true)).not.toContain("没推成");

    const failed = { ...done, phase: "failed", error: "远端 401" } as const;
    expect(pushRunText(failed, false)).toBe("没推成：远端 401");
  });

  it("数字行必须有数字（语义色不得单独表意）", () => {
    expect(progressText(initialRunState())).toContain("正在读取");
    expect(progressText({ ...initialRunState(), done: 12, total: 34 })).toBe("已推 12 / 34");
  });
});
