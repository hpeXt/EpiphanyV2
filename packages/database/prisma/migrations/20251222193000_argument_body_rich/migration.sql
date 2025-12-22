-- Step 23: rich-text body for arguments (TipTap/ProseMirror JSON)
ALTER TABLE "arguments" ADD COLUMN "body_rich" JSONB;
