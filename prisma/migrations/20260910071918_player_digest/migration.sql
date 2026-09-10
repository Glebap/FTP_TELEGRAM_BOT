-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "firstName" TEXT,
    "age" INTEGER,
    "countryCode" TEXT,
    "countryName" TEXT,
    "city" TEXT,
    "cityGeonameId" INTEGER,
    "photoFileId" TEXT,
    "about" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isRegistered" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "notifyNewPlayers" BOOLEAN NOT NULL DEFAULT true,
    "lastDigestAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("about", "age", "city", "cityGeonameId", "countryCode", "countryName", "createdAt", "firstName", "id", "isActive", "isBlocked", "isRegistered", "photoFileId", "telegramId", "telegramUsername", "updatedAt") SELECT "about", "age", "city", "cityGeonameId", "countryCode", "countryName", "createdAt", "firstName", "id", "isActive", "isBlocked", "isRegistered", "photoFileId", "telegramId", "telegramUsername", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "User_isActive_isRegistered_idx" ON "User"("isActive", "isRegistered");
CREATE INDEX "User_city_idx" ON "User"("city");
CREATE INDEX "User_cityGeonameId_idx" ON "User"("cityGeonameId");
CREATE INDEX "User_countryCode_idx" ON "User"("countryCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
