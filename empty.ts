// Stub module for Turbopack's client-bundle resolveAlias (next.config.ts).
// pdfme's optional PDF-to-image converter (@pdfme/converter → clawpdf) has a
// Node-only fallback branch that references the `module` built-in even though
// it's never reached in the browser (we only use pdfme's Designer/generator,
// not the converter). This empty module satisfies the bundler; nothing here
// is ever executed.
export {};
