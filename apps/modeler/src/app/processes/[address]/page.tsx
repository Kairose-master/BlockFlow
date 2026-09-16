import { BoardLoader } from "@/components/BoardLoader";

export default async function BoardPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <BoardLoader address={address} />;
}
