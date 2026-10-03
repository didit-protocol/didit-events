import type { ReactNode } from "react";
import s from "./Screen.module.css";

/**
 * The actions of a sheet or a modal step: one footer on its bottom edge, the primary action last (at the very
 * bottom, full width) and a quiet second action above it. In the join modal and the sheets it stays there while the
 * content scrolls under it; on a plain page it follows the content. Its own module, so a client form takes it
 * without the rest of the screen kit.
 */
export const SheetFooter = ({ children }: { children: ReactNode }) => (
  <div className={s.sheetFoot} data-sheet-footer="">
    {children}
  </div>
);
