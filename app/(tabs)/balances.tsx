import { PeriodOverview } from "../../components/PeriodOverview";

// Shown as the "Accounts" tab. Not named accounts.tsx: /accounts is already
// the Manage accounts screen (app/accounts.tsx).
export default function BalancesScreen() {
  return <PeriodOverview section="accounts" />;
}
