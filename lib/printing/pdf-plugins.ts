import { ellipse, image, line, multiVariableText, rectangle, table, text } from "@pdfme/schemas";

// The ONE set of pdfme schema plugins the app knows how to render - shared by
// every place a template is turned into pixels/PDF bytes: the admin Designer
// (app/(dashboard)/admin/receipts/receipt-designer.tsx), the builder's live
// preview (preview-dialog.tsx), and the counter's PDF route
// (app/api/receipts/[billId]/pdf/route.ts). If a saved template references a
// plugin type missing from this list, it silently fails to render that field -
// so this is the single source of truth for "what field types exist" (dev-rules
// §2). @pdfme/schemas is isomorphic (browser + Node), so this module is safe to
// import from both client components and server route handlers.
export const PDF_PLUGINS = { text, table, image, rectangle, line, ellipse, multiVariableText };
