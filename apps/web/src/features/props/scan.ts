/**
 * 导入时的"陌生键"扫描（2026-10-11，《MeNote 属性库设计 v1》v2.1 §6.3）。
 *
 * ## 只做一件事
 *
 * 把用户选中的文件读一遍 front matter，列出**库里还没有的键**（内置键不算——`status` /
 * `due` / `priority` 有专用控件，不该被当成"陌生属性"收进库）。结果交给导入流程插一步
 * 「录入 / 跳过」，**用户不点就不进库**（设计 §6.4：只在用户主动动过时收录）。
 *
 * ## 为什么在这儿读文件
 *
 * 真正的导入（`import-md.ts` 的 `importMarkdownFiles`）也会把文件读一遍。两遍读取是**故意**的：
 * 录入步必须在导入**之前**发生（用户确认过 §6.3 的顺序），而那时文件还没进 `items`。
 * 读文件只花内存、不写库，重复一遍换来的是"用户没确认之前什么都不落盘"。
 */
import { readForeignKeys } from "@menote/mdcore";
import type { PropLibraryEntry } from "@menote/shared";
import { isMarkdownFileName, stripBom } from "../notes/import-md";
import { isBuiltinKey } from "./model";

/** 一个陌生键在多份文件里的汇总 */
export interface UnknownKeyHit {
  /** 键名（原样，未做任何加工） */
  key: string;
  /** 出现在多少**篇**文件里（同一文件里出现两次只算一篇） */
  count: number;
  /** 第一篇里的原值（块序列会带缩进子行；界面只展示第一行） */
  sample: string;
  /** 原值是块序列（YAML 的 `- ` 子行）——决定录入时默认哪个控件 */
  block: boolean;
}

/**
 * 扫出"库里还没有的键"。顺序 = 首次出现的顺序（界面按此列，别排序——用户是照文件顺序看的）。
 *
 * 读不出的文件（非 md、`text()` 抛错、非 UTF-8 之类）**跳过而不是中断**：导入本身会再报一次
 * 那个文件的问题，录入步不该抢在它前面失败。
 */
export async function scanUnknownKeys(
  files: readonly File[],
  library: readonly PropLibraryEntry[],
): Promise<UnknownKeyHit[]> {
  const known = new Set(library.map((entry) => entry.key));
  const hits = new Map<string, UnknownKeyHit>();
  for (const file of files) {
    if (!isMarkdownFileName(file.name)) continue;
    let text: string;
    try {
      text = stripBom(await file.text());
    } catch {
      continue;
    }
    // 同一文件里同一个键出现两次只算一篇，所以用 Set 去重后再累加
    const keys = new Set(readForeignKeys(text).map((one) => one.key));
    for (const key of keys) {
      if (isBuiltinKey(key) || known.has(key)) continue;
      const existing = hits.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const foreign = readForeignKeys(text).find((one) => one.key === key);
      hits.set(key, {
        key,
        count: 1,
        sample: foreign?.value ?? "",
        block: foreign?.block ?? false,
      });
    }
  }
  return [...hits.values()];
}
