const TAB_COUNT = 10; // # of tabs to open from pinboard

type Bookmark = {
  href: string;
  description: string;
  toread: string;
};

/**
 * Returns the currently stored bookmarks in local storage.
 * 
 * @returns {Promise<Array<Bookmark>>} 
 */
function getLocalBookmarks(): Promise<Array<Bookmark>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("pinboard", localData => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      }

      resolve(localData.pinboard);
    });
  });
}

/**
 * Sets local bookmark data.
 * 
 * @param {Array<Bookmark>} bookmarks 
 * @returns {Promise<void>} 
 */
function setLocalBookmarks(bookmarks: Array<Bookmark>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ pinboard: bookmarks }, () => {
      updateBadgeCount();
      resolve();
    });
  });
}

/**
 * Returns the current stored last-updated time.
 * 
 * @returns {Promise<string>} 
 */
function getOldUpdatedTime(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("pinboardUpdated", localData => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      }

      resolve(localData.pinboardUpdated);
    });
  });
}

/**
 * Sets the stored last-updated time.
 * 
 * @param {string} time 
 */
function setOldUpdatedTime(time: string): void {
  chrome.storage.local.set({ pinboardUpdated: time });
}

/**
 * Fetches the new last-updated time from pinboard.
 * 
 * @returns {Promise<string>} 
 */
function getNewUpdatedTime(): Promise<string> {
  const updateQuery = `https://api.pinboard.in/v1/posts/update?auth_token=${AUTH_TOKEN}&format=json`;

  return new Promise((resolve, reject) => {
    fetch(updateQuery)
    .then(res => res.json())
    .then(data => {
      resolve(data.update_time);
    })
    .catch(err => {
      reject(err);
    });
  });
}

/**
 * Updates the badge # on the chrome extension icon.
 * 
 * @returns {Promise<void>} 
 */
async function updateBadgeCount(): Promise<void> {
  const bookmarks = await getLocalBookmarks();
  const count = filterUnread(bookmarks).length;

  chrome.browserAction.setBadgeText({ text: String(count > 0 ? count : "") });
  chrome.browserAction.setBadgeBackgroundColor({ color: "#000" });
}

/**
 * Takes an array of Bookmark type objects and returns the ones which are not read.
 * 
 * @param {Array<Bookmark>} bookmarks 
 * @returns {Array<Bookmark>} 
 */
function filterUnread(bookmarks: Array<Bookmark>): Array<Bookmark> {
  return bookmarks.filter(item => item.toread === "yes");
}

/**
 * Sends a chrome notification to the user with a given message.
 * 
 * @param {string} message 
 */
function sendNotification(message: string): void {
  chrome.notifications.create(null, {
    type: "basic",
    title: "Pinboard Opener",
    message: message,
    iconUrl: "icon.png"
  });
}

/**
 * Returns a promise for whether or not to update data
 * 
 * @returns {Promise<Boolean>}
 */
async function shouldFetchNew(): Promise<Boolean> {
  // Get the stored updated time
  const oldUpdated = await getOldUpdatedTime();

  // Fetch the latest updated time
  const newUpdated = await getNewUpdatedTime();

  if (oldUpdated !== newUpdated) {
    // Set the latest time we've updated our local data
    setOldUpdatedTime(newUpdated);
    return true;
  }

  return false;
}

/**
 * Updates the local storage with the latest pinboard data.
 * 
 * @returns {Promise<void>} 
 */
function fetchNew(): Promise<void> {
  const query =
    `https://api.pinboard.in/v1/posts/all` +
    `?auth_token=${AUTH_TOKEN}` +
    `&format=json`;

  // Wrap the fetch syntax with an async-await promise
  return new Promise((resolve, reject) => {
    fetch(query)
      .then(response => response.json())
      .then(data => setLocalBookmarks(data))
      .catch(error => {
        reject(error);
      });
  });
}

/**
 * Checks and fetches for new data from pinboard.
 * 
 */
async function updateData(): Promise<void> {
  const shouldFetch = await shouldFetchNew();

  if (shouldFetch) {
    await fetchNew();
  }
}

/**
 * Marks the given bookmarks as read.
 * 
 * @param {Array<Bookmark>} bookmarks 
 * @param {Array<Bookmark>} readBookmarks 
 * @returns {Promise<void>} 
 */
function markBookmarksRead(
  bookmarks: Array<Bookmark>,
  readBookmarks: Array<Bookmark>
): Promise<void> {
  // Create an array of fetch requests to mark as read (but do not call yet)
  const markReadPromises = readBookmarks.map(bookmark =>
    fetch(
      `https://api.pinboard.in/v1/posts/add?auth_token=${AUTH_TOKEN}&format=json` +
        `&url=${encodeURIComponent(bookmark.href)}` +
        `&description=${encodeURIComponent(bookmark.description)}` +
        `&toread=no` // This is the important mutation
    )
  );

  return new Promise((resolve, reject) => {
    // Send all requests and check for any that failed
    Promise.all(markReadPromises)
      .then(responses =>
        Promise.all(responses.map(response => response.json()))
          .then(responses => {
          // If any of the fetch requests returned failing, throw an error
          if (responses.filter(res => res.result_code !== "done").length) {
            reject(new Error(JSON.stringify(responses)));
          }

          // Now update the local data to reflect the changes to unread
          const bookmarksCopy = JSON.parse(JSON.stringify(bookmarks));

          // In the local store, mark these bookmarks as read
          readBookmarks.map(bookmark => {
            const index = bookmarksCopy.findIndex(
              item => item.description === bookmark.description
            );

            bookmarksCopy[index].toread = "no";
          });

          setLocalBookmarks(bookmarksCopy);

          resolve();
        })
      )
      .catch(error => reject(error));
  });
}

/**
 * Called everytime the chrome extension icon is clicked
 * 
 * @returns {Promise<void>} 
 */
async function handleClick(): Promise<void> {
  await updateData();

  const bookmarks = await getLocalBookmarks();
  const unreadBookmarks = filterUnread(bookmarks);

  if (!unreadBookmarks.length) {
    sendNotification(`There aren't any unread bookmarks to open!`);
    return;
  }

  const truncatedUnreadBookmarks = unreadBookmarks.slice(0, TAB_COUNT);

  sendNotification(`Opening ${truncatedUnreadBookmarks.length} tabs from pinboard.`);

  // Open the bookmarks
  truncatedUnreadBookmarks.map(bookmark =>
    chrome.tabs.create({
      url: bookmark.href,
      active: false
    })
  );

  // Mark the bookmarks read on pinboard
  await markBookmarksRead(bookmarks, truncatedUnreadBookmarks);
}

/**
 * Sets up the extension and starts its pinging for new updates.
 * 
 */
function init(): void {
  // Set initial badge count
  updateBadgeCount();

  // Setup mouse click listener for extension
  chrome.browserAction.onClicked.addListener(handleClick);

  // Create and add listener for updates to local pinboard data
  chrome.alarms.create("pinboard-opener", {
    when: Date.now() + 1000,
    periodInMinutes: 5
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === "pinboard-opener") {
      updateData();
    }
  });
}

init();
