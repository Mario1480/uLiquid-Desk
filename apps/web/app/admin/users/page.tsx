"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

type UsersResponse = {
  items: Array<{
    id: string;
    email: string;
    name: string;
    status: string;
    role: string;
    workspaceCount: number;
    botCount: number;
    licenseStatus: string;
    lastLoginAt: string | null;
    lastActiveAt: string | null;
    createdAt: string | null;
    isSuperadmin: boolean;
  }>;
  pagination: {
    page: number;
    totalPages: number;
  };
  filterOptions: {
    status: string[];
    role: string[];
    licenseStatus: string[];
  };
};

function normalizeUsersResponse(input: any): UsersResponse {
  const items = Array.isArray(input?.items) ? input.items : [];
  const filterOptions = input?.filterOptions ?? {};
  const page = Number(input?.pagination?.page);
  const totalPages = Number(input?.pagination?.totalPages);

  return {
    items: items.map((item: any) => ({
      id: String(item?.id ?? ""),
      email: String(item?.email ?? ""),
      name: String(item?.name ?? item?.email ?? "Unknown"),
      status: String(item?.status ?? "unknown"),
      role: String(item?.role ?? "Unknown"),
      workspaceCount: Number(item?.workspaceCount ?? item?.workspaceMemberships ?? 0),
      botCount: Number(item?.botCount ?? item?.bots ?? 0),
      licenseStatus: String(item?.licenseStatus ?? "unknown"),
      lastLoginAt: typeof item?.lastLoginAt === "string" ? item.lastLoginAt : null,
      lastActiveAt: typeof item?.lastActiveAt === "string" ? item.lastActiveAt : null,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
      isSuperadmin: Boolean(item?.isSuperadmin)
    })),
    pagination: {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1
    },
    filterOptions: {
      status: Array.isArray(filterOptions.status) ? filterOptions.status.map(String) : [],
      role: Array.isArray(filterOptions.role) ? filterOptions.role.map(String) : [],
      licenseStatus: Array.isArray(filterOptions.licenseStatus) ? filterOptions.licenseStatus.map(String) : []
    }
  };
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = normalizeUsersResponse(await apiGet<any>(
          `/admin/users${buildQuery({ page, search, status, role, licenseStatus })}`
        ));
        if (!active) return;
        setData(next);
      } catch (loadError) {
        if (!active) return;
        setError(adminErrMsg(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [licenseStatus, page, role, search, status]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        title="Users"
        description="Global user directory with server-side search, filtering, and pagination."
      />

      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Search</span>
            <input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Name or email" />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Status</span>
            <select className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.status?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Role</span>
            <select className="input" value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.role?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">License</span>
            <select className="input" value={licenseStatus} onChange={(event) => { setPage(1); setLicenseStatus(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.licenseStatus?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </AdminFilterBar>

      {loading ? <div className="settingsMutedText">Loading users…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data && data.items.length > 0 ? (
        <>
          <AdminTable
            columns={["Email", "Name", "Status", "Role", "Workspaces", "Bots", "License", "Last Login", "Last Active", "Created"]}
          >
            {data.items.map((user) => (
              <tr
                key={user.id}
                className="adminTableRowInteractive"
                onClick={() => router.push(`/admin/users/${user.id}`)}
              >
                <td>
                  <strong>{user.email}</strong>
                  {user.isSuperadmin ? <div className="settingsMutedText">superadmin</div> : null}
                </td>
                <td>{user.name}</td>
                <td><AdminStatusBadge value={user.status} /></td>
                <td>{user.role}</td>
                <td>{user.workspaceCount}</td>
                <td>{user.botCount}</td>
                <td><AdminStatusBadge value={user.licenseStatus} /></td>
                <td>{formatDateTime(user.lastLoginAt)}</td>
                <td>{formatDateTime(user.lastActiveAt)}</td>
                <td>{formatDateTime(user.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>

          <AdminPagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onPageChange={setPage}
          />
        </>
      ) : null}

      {!loading && data && data.items.length === 0 ? (
        <AdminEmptyState title="No users found" description="Try broadening the current search or filters." />
      ) : null}
    </div>
  );
}
