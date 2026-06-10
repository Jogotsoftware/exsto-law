// The engagement letter generate handler is structurally identical to the
// draft.generate handler: it writes the markdown to a content_blob, creates a
// new engagement_letter entity, adds a document_version, links it to the
// matter, and references the reasoning trace produced by the api function.
//
// We re-use the legal.draft.generate handler by routing through it: the api
// function for the engagement letter calls submitAction with kind
// 'legal.draft.generate' but document_kind='engagement_letter'. So no
// separate handler registration is necessary here.
//
// This file exists to make the imports tree explicit and document the
// substitution. If engagement letter generation grows distinct semantics, it
// gets its own handler and we register here.
export {}
