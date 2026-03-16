// Central settings store for cgen modules
// This module holds the settings passed to the codegen entry point
// and makes them accessible to all cgen modules

let settings = {}

let resetSettings = (userSettings) => {
  settings = { ...userSettings }
}

let getSettings = () => settings

module.exports = { getSettings, resetSettings }
