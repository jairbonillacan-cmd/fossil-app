//! Strongly-typed identifiers for the Fossil object graph.
//!
//! The wire/storage format is the Ulid string; `new()` generates one and
//! `as_ulid()` parses it back. String-backed on purpose: SQLite columns,
//! IPC payloads and TypeScript all see `string`, with validation at the
//! boundary (spec r1-objects-storage §Model).

use serde::{Deserialize, Serialize};

macro_rules! string_id {
    ($name:ident) => {
        #[derive(
            Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
        )]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            /// Generates a new identifier.
            pub fn new() -> Self {
                Self(ulid::Ulid::generate().to_string())
            }

            /// Parses the inner Ulid, if valid.
            pub fn as_ulid(&self) -> Option<ulid::Ulid> {
                self.0.parse().ok()
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

string_id!(ObjectId);
string_id!(BlockId);

#[cfg(test)]
mod tests {
    use super::{BlockId, ObjectId};

    #[test]
    fn generates_valid_ulids() {
        let id = ObjectId::new();
        assert!(id.as_ulid().is_some());
        assert_eq!(id.0.len(), 26);
    }

    #[test]
    fn round_trips_through_serde_as_string() {
        let id = BlockId::new();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{}\"", id.0));
        let back: BlockId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }
}
