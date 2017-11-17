# 📍 Pinboard Opener

Chrome extension for [pinboard](https://pinboard.in/) that adds a browser action which opens the 10 most recent unread items from a user's bookmark list.

---

Not distributed widely because I didn't want to handle adding an authentication method. If you'd like to use it:

1. Clone the repository.
2. Add a file named `auth.ts` to the `src` folder.
3. Set the contents of the file to: `const AUTH_TOKEN = '<username>:<auth_token>';`, where the string is a [pinboard authentication token](https://pinboard.in/settings/password).
4. Build all the files with typescript: `yarn start` or `npm start`.
5. Add the folder as [an unpacked extension](https://developer.chrome.com/extensions/getstarted#update-code) to chrome.
