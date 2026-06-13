// Keychain helper — no secrets in CLI arguments.
// Usage:
//   set    <service> <account>   — reads value from stdin, stores in Keychain
//   get    <service> <account>   — retrieves value from Keychain, writes to stdout
//   delete <service> <account>   — removes entry from Keychain
import Foundation
import Security

let args = CommandLine.arguments
guard args.count >= 4 else {
    fputs("Usage: keychain-helper (set|get|delete) <service> <account>\n", stderr)
    exit(1)
}

let command = args[1]
let service  = args[2]
let account  = args[3]

func searchQuery() -> [CFString: Any] {
    return [
        kSecClass:       kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
    ]
}

switch command {

case "set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    var q = searchQuery()
    q[kSecValueData] = data

    var status = SecItemAdd(q as CFDictionary, nil)
    if status == errSecDuplicateItem {
        let attrs: [CFString: Any] = [kSecValueData: data]
        status = SecItemUpdate(searchQuery() as CFDictionary, attrs as CFDictionary)
    }
    if status != errSecSuccess {
        fputs("Error \(status)\n", stderr)
        exit(1)
    }

case "get":
    var q = searchQuery()
    q[kSecReturnData]  = true
    q[kSecMatchLimit]  = kSecMatchLimitOne

    var item: AnyObject?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else {
        exit(1)
    }
    FileHandle.standardOutput.write(data)

case "delete":
    SecItemDelete(searchQuery() as CFDictionary)

default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
}
