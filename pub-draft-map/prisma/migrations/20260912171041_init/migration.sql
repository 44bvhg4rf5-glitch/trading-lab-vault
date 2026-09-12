-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DRINKER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pub" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "osmId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pub',
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "street" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'osm',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "claimedById" TEXT,
    "claimedAt" DATETIME,
    CONSTRAINT "Pub_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Brewery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "website" TEXT
);

-- CreateTable
CREATE TABLE "Beer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "breweryId" TEXT NOT NULL,
    "style" TEXT,
    "abv" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Beer_breweryId_fkey" FOREIGN KEY ("breweryId") REFERENCES "Brewery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TapListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubId" TEXT NOT NULL,
    "beerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pricePence" INTEGER,
    "servingMl" INTEGER NOT NULL DEFAULT 568,
    "reportedById" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "removedAt" DATETIME,
    CONSTRAINT "TapListing_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "Pub" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TapListing_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TapListing_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BeerRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "beerId" TEXT NOT NULL,
    "tapListingId" TEXT,
    "score" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BeerRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BeerRating_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BeerRating_tapListingId_fkey" FOREIGN KEY ("tapListingId") REFERENCES "TapListing" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tapListingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'POUR',
    "caption" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Photo_tapListingId_fkey" FOREIGN KEY ("tapListingId") REFERENCES "TapListing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhotoRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "photoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    CONSTRAINT "PhotoRating_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PhotoRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PubSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubId" TEXT,
    "currentPeriodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PubSubscription_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "Pub" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "Pub" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" DATETIME,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deal_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "Pub" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SearchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "beerId" TEXT,
    "pubId" TEXT,
    "lat" REAL,
    "lng" REAL,
    "place" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SearchLog_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SearchLog_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "Pub" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Pub_osmId_key" ON "Pub"("osmId");

-- CreateIndex
CREATE INDEX "Pub_lat_idx" ON "Pub"("lat");

-- CreateIndex
CREATE INDEX "Pub_lng_idx" ON "Pub"("lng");

-- CreateIndex
CREATE INDEX "Pub_city_idx" ON "Pub"("city");

-- CreateIndex
CREATE INDEX "Pub_name_idx" ON "Pub"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brewery_name_key" ON "Brewery"("name");

-- CreateIndex
CREATE INDEX "Beer_name_idx" ON "Beer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Beer_name_breweryId_key" ON "Beer"("name", "breweryId");

-- CreateIndex
CREATE INDEX "TapListing_beerId_status_idx" ON "TapListing"("beerId", "status");

-- CreateIndex
CREATE INDEX "TapListing_pubId_status_idx" ON "TapListing"("pubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TapListing_pubId_beerId_key" ON "TapListing"("pubId", "beerId");

-- CreateIndex
CREATE INDEX "BeerRating_beerId_idx" ON "BeerRating"("beerId");

-- CreateIndex
CREATE UNIQUE INDEX "BeerRating_userId_tapListingId_key" ON "BeerRating"("userId", "tapListingId");

-- CreateIndex
CREATE INDEX "Photo_tapListingId_idx" ON "Photo"("tapListingId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRating_photoId_userId_key" ON "PhotoRating"("photoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PubSubscription_pubId_key" ON "PubSubscription"("pubId");

-- CreateIndex
CREATE INDEX "Event_pubId_startsAt_idx" ON "Event"("pubId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Deal_pubId_validTo_idx" ON "Deal"("pubId", "validTo");

-- CreateIndex
CREATE INDEX "SearchLog_beerId_createdAt_idx" ON "SearchLog"("beerId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchLog_place_createdAt_idx" ON "SearchLog"("place", "createdAt");
