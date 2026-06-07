import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type RefObject } from "react";
import { FileImage, FileText, ImageIcon, ImagePlus, Maximize2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/I18nProvider";
import { AI_RECOGNITION_MAX_IMAGES, AI_RECOGNITION_MAX_TEXT_CHARS } from "@/lib/api/schemas/ai-recognition";
import { cn } from "@/lib/utils";
import type { AIRecognitionImageItem, AIRecognitionInputMode } from "./ai-recognition-dialog-types";

interface AIRecognitionInputTabsProps {
  mode: AIRecognitionInputMode;
  onModeChange: (mode: AIRecognitionInputMode) => void;
  text: string;
  onTextChange: (text: string) => void;
  textInputRef: RefObject<HTMLTextAreaElement | null>;
  images: AIRecognitionImageItem[];
  disabled: boolean;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
}

export function AIRecognitionInputTabs({
  mode,
  onModeChange,
  text,
  onTextChange,
  textInputRef,
  images,
  disabled,
  onAddImages,
  onRemoveImage,
}: AIRecognitionInputTabsProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewImage, setPreviewImage] = useState<AIRecognitionImageItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const canAddMoreImages = images.length < AI_RECOGNITION_MAX_IMAGES && !disabled;

  // 图片墙缩略图跟随 File 项存在；放大预览单独创建短命 URL，关闭即可释放而不破坏列表缩略图。
  useEffect(() => {
    if (!previewImage) {
      setPreviewUrl(null);
      return undefined;
    }

    const nextPreviewUrl = createPreviewObjectUrl(previewImage.file);
    setPreviewUrl(nextPreviewUrl);
    return () => {
      if (nextPreviewUrl) URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [previewImage]);

  function handleFiles(files: File[]) {
    setDragActive(false);
    if (files.length === 0 || !canAddMoreImages) return;
    onAddImages(files);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!canAddMoreImages) return;
    event.preventDefault();
    setDragActive(true);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    if (!canAddMoreImages) return;
    event.preventDefault();
    handleFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (mode !== "image" || !canAddMoreImages) return;
    const pastedImages = getImageFilesFromClipboard(event.clipboardData);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    handleFiles(pastedImages);
  }

  return (
    <Tabs value={mode} onValueChange={(value) => onModeChange(value as AIRecognitionInputMode)} onPaste={handlePaste} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-3 border-b border-border bg-secondary/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{mode === "text" ? t("aiRecognition.inputText") : t("aiRecognition.imageDropTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{mode === "text" ? t("aiRecognition.inputHint") : t("aiRecognition.imageDropDescription", { count: AI_RECOGNITION_MAX_IMAGES })}</p>
        </div>
        <TabsList className="grid h-8 w-full grid-cols-2 rounded-md border border-border bg-background p-0.5 sm:w-52">
          <TabsTrigger value="text" disabled={disabled} className="h-7 gap-1.5 rounded-[5px] px-2.5 text-xs shadow-none data-[state=active]:bg-secondary data-[state=active]:shadow-none">
            <FileText className="h-3.5 w-3.5" />
            {t("aiRecognition.inputModeText")}
          </TabsTrigger>
          <TabsTrigger value="image" disabled={disabled} className="h-7 gap-1.5 rounded-[5px] px-2.5 text-xs shadow-none data-[state=active]:bg-secondary data-[state=active]:shadow-none">
            <ImageIcon className="h-3.5 w-3.5" />
            {t("aiRecognition.inputModeImage")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="text" data-testid="ai-recognition-text-panel" className="m-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden p-3">
        <Label htmlFor="ai-recognition-text" className="sr-only">{t("aiRecognition.inputText")}</Label>
        <Textarea
          ref={textInputRef}
          id="ai-recognition-text"
          value={text}
          disabled={disabled}
          onChange={(event) => onTextChange(event.target.value.slice(0, AI_RECOGNITION_MAX_TEXT_CHARS))}
          placeholder={t("aiRecognition.inputPlaceholder")}
          className="h-full min-h-0 resize-none border-border bg-card text-sm leading-6"
        />
        <div className="flex justify-end text-xs tabular-nums text-muted-foreground">
          <span>{text.length}/{AI_RECOGNITION_MAX_TEXT_CHARS}</span>
        </div>
      </TabsContent>

      <TabsContent value="image" data-testid="ai-recognition-image-panel" className="m-0 flex min-h-0 flex-col gap-3 overflow-hidden p-3">
        <Input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          disabled={!canAddMoreImages}
          onChange={handleFileInputChange}
          aria-label={t("aiRecognition.imageFileInput")}
        />
        <div data-testid="ai-recognition-image-scrollport" className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[repeat(auto-fill,6rem)] gap-2">
            <button
              type="button"
              disabled={!canAddMoreImages}
              className={cn(
                "group flex aspect-square w-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
                canAddMoreImages && "hover:border-primary/50 hover:bg-secondary/30",
                dragActive && "border-primary bg-secondary/50",
              )}
              onClick={() => canAddMoreImages && fileInputRef.current?.click()}
              onDragEnter={handleDragOver}
              onDragOver={handleDragOver}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                <ImagePlus className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate text-xs font-medium text-foreground">
                {images.length >= AI_RECOGNITION_MAX_IMAGES
                  ? t("aiRecognition.imageMaxReached")
                  : images.length > 0 ? t("aiRecognition.addMoreImages") : t("aiRecognition.addImages")}
              </span>
              <span className="max-w-full truncate text-[11px] leading-none text-muted-foreground">
                {t("aiRecognition.imageCount", { count: images.length, max: AI_RECOGNITION_MAX_IMAGES })}
              </span>
            </button>
            {images.map((image) => (
              <div key={image.id} className="group relative overflow-hidden rounded-md border border-border bg-card">
                <button
                  type="button"
                  className="block aspect-square w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={disabled}
                  onClick={() => setPreviewImage(image)}
                  aria-label={t("aiRecognition.previewImage", { name: image.file.name })}
                >
                  {image.thumbnailUrl ? (
                    <img src={image.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
                      <FileImage className="h-8 w-8" />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-background/90 px-2 py-1 text-left text-xs text-muted-foreground backdrop-blur">
                    <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{image.file.name}</span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute right-1.5 top-1.5 h-7 w-7 border border-border bg-background/90 text-muted-foreground opacity-100 shadow-sm hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                  disabled={disabled}
                  onClick={() => onRemoveImage(image.id)}
                  aria-label={t("aiRecognition.removeImage")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
          <DialogContent layout="content" className="max-w-4xl border-border bg-card p-0">
            <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left">
              <DialogTitle className="truncate text-base">{previewImage?.file.name ?? t("aiRecognition.imagePreviewTitle")}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[75vh] overflow-auto bg-secondary/20 p-3">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md border border-border bg-background object-contain" />
              ) : (
                <div className="flex min-h-60 items-center justify-center rounded-md border border-border bg-background text-sm text-muted-foreground">
                  {t("aiRecognition.imagePreviewUnavailable")}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </TabsContent>
    </Tabs>
  );
}

function createPreviewObjectUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function getImageFilesFromClipboard(clipboardData: DataTransfer): File[] {
  const filesFromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (filesFromItems.length > 0) return filesFromItems;

  // 部分浏览器只在 files 暴露剪贴板图片；仍只拿 image/*，避免吞掉普通文本粘贴。
  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
}
