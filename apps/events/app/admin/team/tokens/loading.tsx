import { TokensView } from "./TokensView";

// The tokens skeleton (without this file the URL would flash the Team table skeleton of ../loading.tsx).
export default function TokensLoading() {
  return <TokensView email="" tokens={null} now={new Date(0)} />;
}
