"use client";
import dynamic from "next/dynamic";
const templates = {
 "login-page": dynamic(()=>import("../blocks/auth/login-page")),
 "signup-page": dynamic(()=>import("../blocks/auth/signup-page")),
 "forgot-password-page": dynamic(()=>import("../blocks/auth/forgot-password-page")),
 "pricing-page": dynamic(()=>import("../blocks/pricing/page")),
 "admin-panel": dynamic(()=>import("../blocks/admin/page")),
 "dashboard-page": dynamic(()=>import("../blocks/dashboard/page")),
};
export default function Templates({name}: {name:string}) {
 const Component=templates[name as keyof typeof templates];
 if(!Component) throw new Error(`Missing template example: ${name}`);
 return <Component/>;
}
