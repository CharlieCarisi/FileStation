import { PptxViewer } from "@aiden0z/pptx-renderer/browser";
import { checkOfficeArchive, OFFICE_COMPLEXITY_ERROR } from "./office-archive";
import "./presentation-frame.css";
let viewer: PptxViewer | undefined,
  channel = "",
  started = false;
const FAILURE =
  "This presentation could not be previewed. It may be password-protected or damaged. Download it to open it.";
function report(type: string, extra: Record<string, unknown> = {}) {
  parent.postMessage({ type, channel, ...extra }, "*");
}
function complete() {
  report("rendered", {
    slides: viewer!.slideCount,
    slide: viewer!.currentSlideIndex,
    width: viewer!.slideWidth,
    height: viewer!.slideHeight,
  });
}
window.addEventListener("message", async (event) => {
  if (event.source !== parent) return;
  const message = event.data;
  try {
    if (
      message?.type === "load-presentation" &&
      !started &&
      typeof message.channel === "string" &&
      message.buffer instanceof ArrayBuffer
    ) {
      channel = message.channel;
      started = true;
      await checkOfficeArchive(message.buffer, "ppt/presentation.xml");
      viewer = await PptxViewer.open(
        message.buffer,
        document.getElementById("slides")!,
        {
          externalMedia: "block",
          pdfjs: false,
          lazySlides: true,
          lazyMedia: true,
          fitMode: "contain",
          renderMode: "slide",
          zipLimits: {
            maxEntries: 4000,
            maxEntryUncompressedBytes: 50 * 1024 * 1024,
            maxTotalUncompressedBytes: 200 * 1024 * 1024,
            maxMediaBytes: 150 * 1024 * 1024,
            maxConcurrency: 2,
          },
        },
      );
      if (!viewer.slideCount || viewer.slideCount > 300)
        throw Error(OFFICE_COMPLEXITY_ERROR);
      complete();
    } else if (
      message?.type === "show-slide" &&
      viewer &&
      message.channel === channel &&
      Number.isInteger(message.slide) &&
      message.slide >= 0 &&
      message.slide < viewer.slideCount
    ) {
      await viewer.renderSlide(message.slide);
      complete();
    }
  } catch (error) {
    report("error", {
      error:
        error instanceof Error && error.message === OFFICE_COMPLEXITY_ERROR
          ? error.message
          : FAILURE,
    });
    viewer?.destroy();
  }
});
// No document link can navigate this renderer or open another browsing context.
document.addEventListener(
  "click",
  (event) => {
    if (event.target instanceof Element && event.target.closest("a"))
      event.preventDefault();
  },
  true,
);
window.addEventListener("pagehide", () => viewer?.destroy());
