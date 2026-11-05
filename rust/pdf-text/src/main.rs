use serde::Serialize;
use std::io::{self, Read, Write};

const DEFAULT_MAX_INPUT: usize = 25 * 1024 * 1024;
const DEFAULT_MAX_PAGES: usize = 200;
const DEFAULT_MAX_OUTPUT: usize = 1_000_000;

fn limit(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

#[derive(Serialize)]
struct ResultPayload {
    markdown: String,
    page_count: usize,
}

fn extract(bytes: &[u8]) -> Result<ResultPayload, String> {
    if bytes.len() > limit("PDF_MAX_BYTES", DEFAULT_MAX_INPUT) {
        return Err("PDF exceeds 25 MiB limit".into());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("Input is not a PDF".into());
    }
    let mut pdf = pdf_oxide::api::Pdf::from_bytes(bytes.to_vec()).map_err(|e| e.to_string())?;
    if pdf
        .editor()
        .is_some_and(|e| e.source().is_encrypted() && !e.source().is_authenticated())
    {
        return Err("Encrypted PDF is not supported".into());
    }
    let count = pdf.page_count().map_err(|e| e.to_string())?;
    let max_pages = limit("PDF_MAX_PAGES", DEFAULT_MAX_PAGES);
    if count == 0 || count > max_pages {
        return Err(format!("PDF page count must be between 1 and {max_pages}"));
    }
    let mut pages = Vec::with_capacity(count);
    let mut output_len = 0usize;
    for page in 0..count {
        let text = pdf.to_markdown(page).map_err(|e| e.to_string())?;
        output_len = output_len.saturating_add(text.len());
        if output_len > limit("PDF_MAX_OUTPUT_BYTES", DEFAULT_MAX_OUTPUT) {
            return Err("Extracted PDF text exceeds 1 MB limit".into());
        }
        pages.push(text);
    }
    Ok(ResultPayload {
        markdown: pages.join("\n\n"),
        page_count: count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Dictionary, Document, Object, Stream, dictionary};

    fn pdf_with_text(text: &str) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(
            dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" },
        );
        let content = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
        let stream_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
            "Contents" => stream_id
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Count" => 1, "Kids" => vec![Object::Reference(page_id)]
            }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn extracts_pdf_text_and_page_count() {
        let result = extract(&pdf_with_text("PaperPilot extraction test")).unwrap();
        assert_eq!(result.page_count, 1);
        assert!(
            result.markdown.contains("PaperPilot extraction test"),
            "{}",
            result.markdown
        );
    }

    #[test]
    fn rejects_non_pdf_and_excessive_size() {
        assert!(extract(b"not a PDF").is_err());
        assert!(extract(&vec![0; DEFAULT_MAX_INPUT + 1]).is_err());
    }
}

fn main() {
    let mut bytes = Vec::new();
    let max_input = limit("PDF_MAX_BYTES", DEFAULT_MAX_INPUT);
    let read_result = io::stdin()
        .take((max_input + 1) as u64)
        .read_to_end(&mut bytes);
    let result = match read_result {
        Ok(_) => extract(&bytes),
        Err(e) => Err(e.to_string()),
    };
    let mut out = io::stdout().lock();
    match result {
        Ok(payload) => {
            let _ = serde_json::to_writer(&mut out, &payload);
        }
        Err(message) => {
            let _ = serde_json::to_writer(&mut out, &serde_json::json!({"error": message}));
            let _ = out.write_all(b"\n");
            std::process::exit(1);
        }
    }
}
