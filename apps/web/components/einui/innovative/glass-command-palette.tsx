"use client"

import * as React from "react"
import { Command, Search, File, Settings, User, Home, Layers, Moon, Sun, ArrowRight } from "lucide-react"
import { GlassDialog, GlassDialogContent, GlassDialogTitle, GlassDialogDescription } from "../liquid-glass/glass-dialog"
import { cn } from "@/components/einui/utils"

interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  shortcut?: string
  action?: () => void
  href?: string
}

interface CommandGroup {
  label: string
  items: CommandItem[]
}

type CommandPalettePosition = "center" | "top" | "bottom" | "left" | "right"

interface GlassCommandPaletteProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  groups?: CommandGroup[]
  placeholder?: string
  position?: CommandPalettePosition
}

const defaultGroups: CommandGroup[] = [
  {
    label: "Navigation",
    items: [
      { id: "home", label: "Home", icon: <Home className="ein:w-4 ein:h-4" />, shortcut: "G H", href: "/" },
      { id: "docs", label: "Documentation", icon: <File className="ein:w-4 ein:h-4" />, shortcut: "G D", href: "/docs" },
      {
        id: "components",
        label: "Components",
        icon: <Layers className="ein:w-4 ein:h-4" />,
        shortcut: "G C",
        href: "/docs/components/cards",
      },
    ],
  },
  {
    label: "Actions",
    items: [
      { id: "settings", label: "Settings", icon: <Settings className="ein:w-4 ein:h-4" />, shortcut: "G S" },
      { id: "profile", label: "Profile", icon: <User className="ein:w-4 ein:h-4" />, shortcut: "G P" },
    ],
  },
  {
    label: "Theme",
    items: [
      { id: "light", label: "Light Mode", icon: <Sun className="ein:w-4 ein:h-4" /> },
      { id: "dark", label: "Dark Mode", icon: <Moon className="ein:w-4 ein:h-4" /> },
    ],
  },
]

const positionStyles: Record<CommandPalettePosition, { container: string; animation: string; wrapper: string }> = {
  center: {
    container: "ein:items-start ein:justify-center ein:pt-[20vh]",
    animation: "ein:animate-in ein:fade-in ein:slide-in-from-top-4 ein:duration-200",
    wrapper: "ein:w-full ein:max-w-xl ein:mx-4",
  },
  top: {
    container: "ein:items-start ein:justify-center ein:pt-4",
    animation: "ein:animate-in ein:fade-in ein:slide-in-from-top-full ein:duration-300",
    wrapper: "ein:w-full ein:max-w-2xl ein:mx-4",
  },
  bottom: {
    container: "ein:items-end ein:justify-center ein:pb-4",
    animation: "ein:animate-in ein:fade-in ein:slide-in-from-bottom-full ein:duration-300",
    wrapper: "ein:w-full ein:max-w-2xl ein:mx-4",
  },
  left: {
    container: "ein:items-center ein:justify-start",
    animation: "ein:animate-in ein:fade-in ein:slide-in-from-left-full ein:duration-300",
    wrapper: "ein:w-full ein:max-w-md ein:h-[80vh] ein:flex ein:flex-col ein:pl-4 ein:pr-4 ein:sm:pr-0",
  },
  right: {
    container: "ein:items-center ein:justify-end",
    animation: "ein:animate-in ein:fade-in ein:slide-in-from-right-full ein:duration-300",
    wrapper: "ein:w-full ein:max-w-md ein:h-[80vh] ein:flex ein:flex-col ein:pr-4 ein:pl-4 ein:sm:pl-0",
  },
}

const GlassCommandPalette = React.forwardRef<HTMLDivElement, GlassCommandPaletteProps>(
  function GlassCommandPalette({open, onOpenChange, groups=defaultGroups, placeholder="Search commands", position="center"}, ref) {
    const [internalOpen,setInternalOpen]=React.useState(false)
    const [search,setSearch]=React.useState("")
    const [selected,setSelected]=React.useState(0)
    const input=React.useRef<HTMLInputElement>(null)
    const returnFocus=React.useRef<HTMLElement | null>(null)
    const id=React.useId()
    const visible=open ?? internalOpen
    const change=React.useCallback((next: boolean)=>{setInternalOpen(next);onOpenChange?.(next)},[onOpenChange])
    const items=React.useMemo(()=>groups.flatMap(group=>group.items).filter(item=>(item.label+" "+(item.description||"")).toLowerCase().includes(search.toLowerCase())),[groups,search])
    React.useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key.toLowerCase()==="k"&&(event.ctrlKey||event.metaKey)){event.preventDefault();change(!visible)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[visible,change])
    React.useEffect(()=>{if(visible){setSearch("");setSelected(0)}},[visible])
    const activate=(item:CommandItem)=>{change(false);item.action?.();if(item.href)window.location.assign(item.href)}
    return <GlassDialog open={visible} onOpenChange={change}><GlassDialogContent ref={ref} data-ein-command-position={position} onOpenAutoFocus={event=>{event.preventDefault();if(document.activeElement instanceof HTMLElement)returnFocus.current=document.activeElement;input.current?.focus()}} onCloseAutoFocus={event=>{event.preventDefault();returnFocus.current?.focus()}}>
      <GlassDialogTitle className="ein:sr-only">Command palette</GlassDialogTitle>
      <GlassDialogDescription className="ein:sr-only">Search and select a command using arrow keys and Enter.</GlassDialogDescription>
      <input ref={input} className="ein-command-input" role="combobox" aria-label="Search commands" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={items[selected] ? id+"-"+selected : undefined} placeholder={placeholder} value={search} onChange={event=>{setSearch(event.target.value);setSelected(0)}} onKeyDown={event=>{if((event.key==="ArrowDown"||event.key==="ArrowUp")&&items.length){event.preventDefault();setSelected(i=>(i+(event.key==="ArrowDown"?1:-1)+items.length)%items.length)}else if(event.key==="Enter"&&items[selected]){event.preventDefault();activate(items[selected])}}}/>
      <div id={id} role="listbox" aria-label="Commands" className="ein:max-h-80 ein:overflow-auto">{items.map((item,index)=><button type="button" id={id+"-"+index} key={item.id} role="option" tabIndex={-1} aria-selected={index===selected} className="ein-command-option" onMouseMove={()=>setSelected(index)} onClick={()=>activate(item)}>{item.icon}<span>{item.label}{item.description&&<small>{item.description}</small>}</span></button>)}</div>
      {!items.length&&<p role="status">No matching commands</p>}
    </GlassDialogContent></GlassDialog>
  }
)
GlassCommandPalette.displayName = "GlassCommandPalette"

// Trigger button component
const GlassCommandTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "ein:flex ein:items-center ein:gap-2 ein:px-3 ein:py-2 ein:rounded-xl",
        "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
        "ein:text-white/60 ein:text-sm",
        "ein:hover:bg-white/15 ein:hover:text-white/80 ein:transition-all",
        "ein:focus:outline-none ein:focus:ring-2 ein:focus:ring-white/20",
        className,
      )}
      {...props}
    >
      <Search className="ein:w-4 ein:h-4" />
      <span className="ein:hidden ein:sm:inline">Search...</span>
      <kbd className="ein:hidden ein:sm:flex ein:items-center ein:gap-0.5 ein:px-1.5 ein:py-0.5 ein:rounded ein:bg-white/10 ein:text-xs">
        <Command className="ein:w-3 ein:h-3" />K
      </kbd>
    </button>
  ),
)
GlassCommandTrigger.displayName = "GlassCommandTrigger"

export { GlassCommandPalette, GlassCommandTrigger }
export type { CommandItem, CommandGroup, CommandPalettePosition }
