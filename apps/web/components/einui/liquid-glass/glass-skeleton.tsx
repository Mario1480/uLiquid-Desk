"use client";
import * as React from "react";
import { cn } from "../utils";
interface GlassSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
 variant?: "default" | "circular" | "text" | "card";
 width?: string | number;
 height?: string | number;
 lines?: number;
}
const GlassSkeleton=React.forwardRef<HTMLDivElement,GlassSkeletonProps>(function GlassSkeleton({className,variant="default",width,height,lines=1,style,...props},ref){
 const classes=cn("ein-skeleton",variant==="circular"?"ein:rounded-full":variant==="text"?"ein:rounded-md ein:h-4":variant==="card"?"ein:rounded-2xl ein:min-h-30":"ein:rounded-xl",className);
 if(variant==="text"&&lines>1)return <div ref={ref} {...props} className="ein:space-y-2">{Array.from({length:lines},(_,i)=><div key={i} className={classes} aria-hidden="true" style={{width:i===lines-1?"75%":width,height,...style}}/>)}</div>;
 return <div ref={ref} className={classes} aria-hidden="true" {...props} style={{width,height,...style}}/>;
});
export { GlassSkeleton };
