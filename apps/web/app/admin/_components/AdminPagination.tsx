import { DeskButton } from "@/components/desk/DeskButton";
import { AppIcon } from "../../components/AppIcon";

type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
};

export default function AdminPagination({ page, totalPages, onPageChange }: AdminPaginationProps) {
  return (
    <div className="adminPagination">
      <DeskButton className="btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <AppIcon name="back" />
        Previous
      </DeskButton>
      <span className="settingsMutedText">
        Page {page} of {Math.max(1, totalPages)}
      </span>
      <DeskButton className="btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        <AppIcon name="chevronRight" />
        Next
      </DeskButton>
    </div>
  );
}
