import { LogTable } from "../../../../../../../src/admin/log/LogTable";
import { LogToolbarPending } from "../../../../../../../src/admin/log/LogView";

// A-09e: the header stays (layout), the toolbar and eight skeleton rows stream in.
export default function CheckInLogLoading() {
  return (
    <>
      <LogToolbarPending />
      <LogTable view="all" loading />
    </>
  );
}
