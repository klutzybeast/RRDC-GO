import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => {
  // Split out any DialogFooter children so we can render them pinned to the
  // bottom of the dialog (outside the scrollable body). This way long admin
  // forms scroll inside the body while Save/Cancel buttons remain visible.
  const childArray = React.Children.toArray(children)
  const footers = childArray.filter(
    (c) => React.isValidElement(c) && c.type && c.type.displayName === "DialogFooter"
  )
  const body = childArray.filter(
    (c) => !(React.isValidElement(c) && c.type && c.type.displayName === "DialogFooter")
  )

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Mobile-first scrollable dialog. Defaults capped at 90vh so the dialog
          // never overflows the viewport on phones/tablets, and the body area
          // scrolls vertically when the content is taller than the available
          // space. Individual dialogs can still override max-w / max-h via
          // className. Padding stays on the inner scrollable area below so the
          // close button stays pinned at the corner. DialogFooter (if any) is
          // rendered pinned at the bottom outside the scroll container.
          "fixed left-[50%] top-[50%] z-50 flex flex-col w-[calc(100%-1rem)] max-w-lg max-h-[calc(100vh-1.5rem)] sm:max-h-[90vh] translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg overflow-hidden",
          className
        )}
        {...props}>
        <div className="overflow-y-auto p-6 flex-1 min-h-0 [&>:not(:first-child)]:mt-4">
          {body}
        </div>
        {footers.length > 0 && (
          <div className="flex-shrink-0 border-t bg-background px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footers}
          </div>
        )}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded-full p-1.5 bg-white/80 hover:bg-white shadow-sm opacity-90 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
