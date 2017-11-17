const TAB_COUNT = 10;

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
function getLocalData(): Promise<Array<Bookmark>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('pinboard', localData => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      }

      resolve(localData.pinboard);
    });
  });
}

/**
 * Updates the badge # on the chrome extension icon.
 */
async function updateBadgeCount(): Promise<void> {
  const bookmarks = await getLocalData();
  const count = filterUnread(bookmarks).length;

  chrome.browserAction.setBadgeText({ text: String(count > 0 ? count : '') });
  chrome.browserAction.setBadgeBackgroundColor({ color: '#000' });
}

/**
 * Takes an array of Bookmark type objects and returns the ones which are not read.
 * 
 * @param {Array<Bookmark>} bookmarks 
 * @returns {Array<Bookmark>} 
 */
function filterUnread(bookmarks: Array<Bookmark>): Array<Bookmark> {
  return bookmarks.filter(item => item.toread === 'yes');
}

/**
 * Returns a promise for whether or
 * 
 * @returns {Promise<Boolean>} 
 */
function shouldFetchNew(): Promise<Boolean> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("pinboardUpdated", localData => {
      const updateQuery = `https://api.pinboard.in/v1/posts/update?auth_token=${AUTH_TOKEN}&format=json`;

      fetch(updateQuery)
        .then(res => res.json())
        .then(data => {
          // Check for new updates from pinboard if the dates are diff.
          if (localData.pinboardUpdated !== data.update_time) {
            console.log('Changes have occured to pinboard since last check.');

            // Set the latest time we've updated our local data
            chrome.storage.local.set({ pinboardUpdated: data.update_time });

            resolve(true);
          }

          resolve(false);
        })
        .catch(err => {
          console.error('Failed to look for pinboard updates: ', err);
          reject(err);
        });
    });
  });
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
      .then(data => {
        chrome.storage.local.set({ pinboard: data }, () => {
          // Notify that we saved.
          console.log('New data (all bookmarks) saved from pinboard api.');
          updateBadgeCount();
          resolve();
        });
      })
      .catch(error => {
        console.error(error);
        reject(error);
      });
  });
}

/**
 * Marks the given bookmarks are read.
 * 
 * @param {Array<Bookmark>} bookmarks 
 * @param {Array<Bookmark>} readBookmarks 
 * @returns {Promise<void>} 
 */
function markBookmarksRead(
  bookmarks: Array<Bookmark>,
  readBookmarks: Array<Bookmark>
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create an array of fetch requests to mark as read (but do not call yet)
    const markReadPromises = readBookmarks.map(bookmark =>
      fetch(
        `https://api.pinboard.in/v1/posts/add?auth_token=${AUTH_TOKEN}&format=json` +
          `&url=${encodeURIComponent(bookmark.href)}` +
          `&description=${encodeURIComponent(bookmark.description)}` +
          `&toread=no` // This is the important mutation
      )
    );

    // Send all requests and check for any that failed
    Promise.all(markReadPromises)
      .then(responses =>
        Promise.all(
          responses.map(response => response.json())
        ).then(responses => {
          const failed = responses.filter(
            response => response.result_code !== 'done'
          );

          // If any of the fetch requests returned failing, throw an error
          if (failed.length) {
            reject();
            throw new Error(JSON.stringify(responses));
          } else {
            // Now update the local data to reflect the changes to unread
            const clonedBookmarks = JSON.parse(JSON.stringify(bookmarks));

            // In the local store, mark these bookmarks as read
            readBookmarks.map(bookmark => {
              const index = clonedBookmarks.findIndex(
                item => item.description === bookmark.description
              );

              clonedBookmarks[index].toread = 'no';
            });

            chrome.storage.local.set({ pinboard: clonedBookmarks }, () => {
              // Notify that we saved.
              console.log('New data saved');
              updateBadgeCount();

              resolve();
            });
          }
        })
      )
      .catch(error => console.error('Failed to mark all as read:', error));
  });
}

/**
 * Called everytime the chrome extension icon is clicked
 * 
 * @returns {Promise<void>} 
 */
async function handleClick(): Promise<void> {
  const shouldFetch = await shouldFetchNew();

  console.group('pinboard opener');
  console.log('shouldFetch:', shouldFetch);

  if (shouldFetch) {
    await fetchNew();
  }

  const bookmarks = await getLocalData();

  console.log('bookmark count #:', bookmarks.length);

  const unreadBookmarks = filterUnread(bookmarks);

  if (!unreadBookmarks.length) {
    console.groupEnd();
    return;
  }

  console.log('unread count #:', unreadBookmarks.length);

  const truncatedUnreadBookmarks = unreadBookmarks.slice(0, TAB_COUNT);

  chrome.notifications.create(null, {
    type: 'basic',
    title: 'Pinboard Opener',
    message: `Opening ${truncatedUnreadBookmarks.length} tabs from pinboard.`,
    iconUrl: 'icon.png',
  });

  // Open the bookmarks
  truncatedUnreadBookmarks.map(bookmark =>
    chrome.tabs.create({
      url: bookmark.href,
      active: false
    })
  );

  await markBookmarksRead(bookmarks, truncatedUnreadBookmarks);

  console.groupEnd();
}

chrome.browserAction.onClicked.addListener(handleClick);

async function interval() {
  console.log('Checking for new updates.');

  const shouldFetch = await shouldFetchNew();

  if (shouldFetch) {
    await fetchNew();
  } else {
    console.log('Did not fetch new data.')
  }
}

// Set initial badge count
interval();
updateBadgeCount();

window.setInterval(interval, 1000 * 60 * 5);
