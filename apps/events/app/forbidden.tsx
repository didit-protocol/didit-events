import { getNonStaffIdentity } from "./admin/forbidden/data";
import { NotStaff } from "../src/admin/system/SystemPages";
export default async function Forbidden() {
  const account = await getNonStaffIdentity();
  return <NotStaff email={account?.email} name={account?.name} photoUrl={account?.photoUrl} />;
}
