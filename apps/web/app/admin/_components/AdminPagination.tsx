type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
};

export default function AdminPagination({ page, totalPages, onPageChange }: AdminPaginationProps) {
  return (
    <div className="adminPagination">
      <button className="btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span className="settingsMutedText">
        Page {page} of {Math.max(1, totalPages)}
      </span>
      <button className="btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
