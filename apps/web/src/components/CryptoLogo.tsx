import { LocalAssetLogo } from "./LocalAssetLogo";

export function CryptoLogo(props: {
  logoUrl?: string | null;
  symbol: string;
  size?: number;
  className?: string;
}) {
  return <LocalAssetLogo {...props} />;
}
