import { DeskButton } from "@/components/desk/DeskButton";
import { AppIcon } from "../../components/AppIcon";

type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
  disabled?: boolean;
  labels?: { previous: string; next: string; page: string };
};

export default function AdminPagination({ page, totalPages, onPageChange, disabled = false, labels }: AdminPaginationProps) {
  return (
    <div className="adminPagination">
      <DeskButton className="btn" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
        <AppIcon name="back" />
        {labels?.previous ?? "Previous"}
      </DeskButton>
      <span className="settingsMutedText">
        {labels?.page ?? `Page ${page} of ${Math.max(1, totalPages)}`}
      </span>
      <DeskButton className="btn" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>
        <AppIcon name="chevronRight" />
        {labels?.next ?? "Next"}
      </DeskButton>
    </div>
  );
}
