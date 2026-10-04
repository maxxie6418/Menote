/**
 * 版本对比视图（M4-11；《M4 界面稿》§4.1 第 4 块）。
 *
 * 两条硬要求：增删用 `--green` / `--red`，**并且配 +/- 前缀文字**（颜色不单独表意）；
 * 容器是**一个**滚动区（列表与对比区各一个，不嵌套，`DESIGN.md` §2.7）。
 */
import { diffPrefix, diffSummary, type DiffResult } from "../model";

export interface VersionDiffProps {
  /** 左（旧）：版本或当前稿 */
  leftTitle: string;
  /** 右（新） */
  rightTitle: string;
  result: DiffResult;
}

export function VersionDiff({ leftTitle, rightTitle, result }: VersionDiffProps) {
  return (
    <div className="versiondiff">
      <div className="versiondiff__head">
        <span className="versiondiff__side">{leftTitle}</span>
        <span className="versiondiff__arrow" aria-hidden="true">
          →
        </span>
        <span className="versiondiff__side">{rightTitle}</span>
        <span className="versiondiff__summary" role="status">
          {diffSummary(result)}
        </span>
      </div>

      {/* `hscroll` + `tabIndex` 的理由同表格网格：横条改成悬停/聚焦才显形，
          键盘必须能进得来，否则这条提示对键盘用户等于不存在。 */}
      <div className="versiondiff__scroll hscroll" tabIndex={0}>
        <ol className="versiondiff__lines">
          {result.lines.map((line, index) => (
            <li
              key={`${line.kind}-${index}`}
              className={`versiondiff__line versiondiff__line--${line.kind}`}
            >
              {/* 前缀文字与颜色一起用：色盲用户与打印都读得出来 */}
              <span className="versiondiff__prefix" aria-hidden="true">
                {diffPrefix(line.kind)}
              </span>
              <span className="versiondiff__text">{line.text === "" ? " " : line.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
