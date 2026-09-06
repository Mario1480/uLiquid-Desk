"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "../../../lib/api";
import { AppIcon } from "../../components/AppIcon";
import AdminConfirmDialog from "../_components/AdminConfirmDialog";
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
    commercialPlan: { plan: string; validUntil: string | null };
    manualPlanOverride: { plan: string; validUntil: string | null; reason: string; active: boolean } | null;
    effectivePlan: { plan: string; validUntil: string | null };
    lastLoginAt: string | null;
    lastActiveAt: string | null;
    createdAt: string | null;
    legalAcknowledgement: {
      version: string;
      textHash: string;
      acceptedAt: string | null;
    } | null;
    isSuperadmin: boolean;
    hasAdminBackendAccess: boolean;
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
      commercialPlan: {
        plan: String(item?.commercialPlan?.plan ?? "free"),
        validUntil: typeof item?.commercialPlan?.validUntil === "string" ? item.commercialPlan.validUntil : null
      },
      manualPlanOverride: item?.manualPlanOverride
        ? {
            plan: String(item.manualPlanOverride.plan ?? "free"),
            validUntil: typeof item.manualPlanOverride.validUntil === "string" ? item.manualPlanOverride.validUntil : null,
            reason: String(item.manualPlanOverride.reason ?? ""),
            active: Boolean(item.manualPlanOverride.active)
          }
        : null,
      effectivePlan: {
        plan: String(item?.effectivePlan?.plan ?? item?.commercialPlan?.plan ?? "free"),
        validUntil: typeof item?.effectivePlan?.validUntil === "string" ? item.effectivePlan.validUntil : null
      },
      lastLoginAt: typeof item?.lastLoginAt === "string" ? item.lastLoginAt : null,
      lastActiveAt: typeof item?.lastActiveAt === "string" ? item.lastActiveAt : null,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
      legalAcknowledgement: item?.legalAcknowledgement
        ? {
            version: String(item.legalAcknowledgement.version ?? ""),
            textHash: String(item.legalAcknowledgement.textHash ?? ""),
            acceptedAt: typeof item.legalAcknowledgement.acceptedAt === "string" ? item.legalAcknowledgement.acceptedAt : null
          }
        : null,
      isSuperadmin: Boolean(item?.isSuperadmin),
      hasAdminBackendAccess: Boolean(item?.hasAdminBackendAccess)
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
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UsersResponse["items"][number] | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [usersPayload, me] = await Promise.all([
          apiGet<any>(`/admin/users${buildQuery({ page, search, status, role, licenseStatus })}`),
          apiGet<any>("/auth/me")
        ]);
        const next = normalizeUsersResponse(usersPayload);
        if (!active) return;
        setData(next);
        setCurrentUserId(String(me?.id ?? me?.user?.id ?? ""));
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

  async function reloadUsers(nextPage = page) {
    const next = normalizeUsersResponse(await apiGet<any>(
      `/admin/users${buildQuery({ page: nextPage, search, status, role, licenseStatus })}`
    ));
    setData(next);
  }

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPost<{
        user: { id: string; email: string; workspaceId: string };
        temporaryPassword: string | null;
      }>("/admin/users", {
        email: newEmail.trim(),
        ...(newPassword.trim() ? { password: newPassword.trim() } : {})
      });
      setNewEmail("");
      setNewPassword("");
      setPage(1);
      setNotice(
        payload.temporaryPassword
          ? `User created. Temporary password: ${payload.temporaryPassword}`
          : "User created successfully."
      );
      await reloadUsers(1);
    } catch (createError) {
      setError(adminErrMsg(createError));
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/admin/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      setNotice(`User ${deleteTarget.email} deleted.`);
      if ((data?.items.length ?? 0) === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await reloadUsers(page);
      }
    } catch (deleteError) {
      setError(adminErrMsg(deleteError));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Identity & Access"
        title="Users"
        description="Global user directory with server-side search, filtering, and pagination."
      />

      <form className="settingsSection adminInlineForm" onSubmit={handleCreateUser}>
        <div className="settingsSectionHeader">
          <h3 className="adminSectionTitle">Create User</h3>
          <DeskButton type="submit" className="btn btnPrimary" disabled={creating || !newEmail.trim()}>
            {creating ? "Creating…" : "Create user"}
          </DeskButton>
        </div>
        <div className="adminFilterGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Email</span>
            <DeskInput className="input" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="user@example.com" />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Initial Password</span>
            <DeskInput className="input" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Optional - generate temporary password if empty" />
          </label>
        </div>
      </form>

      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Search</span>
            <DeskInput className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Name or email" />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Status</span>
            <DeskSelect className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.status?.map((option) => <option key={option} value={option}>{option}</option>)}
            </DeskSelect>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Role</span>
            <DeskSelect className="input" value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.role?.map((option) => <option key={option} value={option}>{option}</option>)}
            </DeskSelect>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">License</span>
            <DeskSelect className="input" value={licenseStatus} onChange={(event) => { setPage(1); setLicenseStatus(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions.licenseStatus?.map((option) => <option key={option} value={option}>{option}</option>)}
            </DeskSelect>
          </label>
        </div>
      </AdminFilterBar>

      {loading ? <div className="settingsMutedText">Loading users…</div> : null}
      {error ? <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertError">{error}</div></DeskSurface> : null}
      {notice ? <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div></DeskSurface> : null}

      {data && data.items.length > 0 ? (
        <>
          <AdminTable
            columns={["Email", "Name", "Status", "Role", "Legal", "Workspaces", "Bots", "Plan", "Last Login", "Last Active", "Created", "Actions"]}
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
                  {!user.isSuperadmin && user.hasAdminBackendAccess ? (
                    <div className="settingsMutedText">backend admin access</div>
                  ) : null}
                </td>
                <td>{user.name}</td>
                <td><AdminStatusBadge value={user.status} /></td>
                <td>{user.role}</td>
                <td>
                  <AdminStatusBadge value={user.legalAcknowledgement?.acceptedAt ? "accepted" : "missing"} />
                  {user.legalAcknowledgement?.version ? (
                    <div className="settingsMutedText">v{user.legalAcknowledgement.version}</div>
                  ) : null}
                </td>
                <td>{user.workspaceCount}</td>
                <td>{user.botCount}</td>
                <td>
                  <AdminStatusBadge value={user.effectivePlan.plan} />
                  <div className="settingsMutedText">commercial: {user.commercialPlan.plan}</div>
                  {user.manualPlanOverride?.active ? (
                    <div className="settingsMutedText">
                      manual: {user.manualPlanOverride.plan} · {formatDateTime(user.manualPlanOverride.validUntil)}
                    </div>
                  ) : null}
                </td>
                <td>{formatDateTime(user.lastLoginAt)}</td>
                <td>{formatDateTime(user.lastActiveAt)}</td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td>
                  {!user.isSuperadmin && user.id !== currentUserId ? (
                    <DeskButton
                      type="button"
                      className="btn btnStop"
                      title="Delete user"
                      aria-label={`Delete ${user.email}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(user);
                      }}
                    >
                      <AppIcon name="delete" />
                    </DeskButton>
                  ) : (
                    <span className="settingsMutedText">Protected</span>
                  )}
                </td>
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

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete user?"
        description={deleteTarget ? `${deleteTarget.email} and all associated user data will be deleted.` : ""}
        confirmLabel="Delete user"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteUser()}
      />
    </div>
  );
}
