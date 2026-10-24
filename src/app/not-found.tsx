import Link from "next/link";
import { SearchX } from "lucide-react";
import { getT } from "@/lib/ui-lang-server";
import { BTN_PRIMARY, Card, Empty } from "@/components/ui";

export default async function NotFound() {
  const t = await getT();
  return (
    <Card className="mt-8">
      <Empty icon={SearchX} title={t("Not found")}>
        {t("That page does not exist, or it was removed.")}
        <div className="mt-4">
          <Link href="/" className={BTN_PRIMARY}>{t("Back to Today")}</Link>
        </div>
      </Empty>
    </Card>
  );
}
