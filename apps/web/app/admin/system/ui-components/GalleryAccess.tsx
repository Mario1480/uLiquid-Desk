"use client";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useAdminAccessGate } from "../../_components/useAdminAccessGate";
const Gallery=dynamic(()=>import("@/components/einui/gallery/Gallery"),{ssr:false});
export default function GalleryAccess() {
 const t=useTranslations("admin.uiGallery");
 const access=useAdminAccessGate(t("denied"));
 if(access.loading) return <p role="status">{t("loading")}</p>;
 if(!access.hasAccess) return <p role="alert">{access.error||t("denied")}</p>;
 return <Gallery/>;
}
