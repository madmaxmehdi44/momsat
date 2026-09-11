CREATE TYPE "ChannelArchiveStatus" AS ENUM ('MEMORY', 'SHUTDOWN');

ALTER TABLE "Channel"
  ADD COLUMN "archiveStatus" "ChannelArchiveStatus",
  ADD COLUMN "archiveNote" TEXT,
  ADD COLUMN "archiveSince" TIMESTAMP(3);

CREATE INDEX "Channel_archiveStatus_idx" ON "Channel"("archiveStatus");
CREATE INDEX "Channel_archiveStatus_archiveSince_idx" ON "Channel"("archiveStatus", "archiveSince");
