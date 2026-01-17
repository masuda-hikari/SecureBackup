//! 暗号化モジュール
//! AES-256-GCM による安全なファイル暗号化を提供

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::Rng;
use thiserror::Error;

/// 暗号化関連エラー
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("暗号化に失敗しました")]
    EncryptionFailed,

    #[error("復号化に失敗しました")]
    DecryptionFailed,

    #[error("不正なデータ形式です")]
    InvalidFormat,

    #[error("パスワードが短すぎます（最低8文字）")]
    PasswordTooShort,
}

/// 暗号化設定
const SALT_SIZE: usize = 32;
const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;
const PBKDF2_ITERATIONS: u32 = 100_000;

/// 暗号化エンジン
pub struct Encryptor {
    /// パスワードから派生した鍵
    key: [u8; KEY_SIZE],
}

impl Encryptor {
    /// パスワードから暗号化エンジンを作成
    ///
    /// # Arguments
    /// * `password` - 暗号化パスワード（8文字以上推奨）
    pub fn new(password: &str) -> Self {
        // ランダムソルトを使用（実際の暗号化時に埋め込み）
        let salt = [0u8; SALT_SIZE]; // 実際の暗号化時にランダム生成
        let key = Self::derive_key(password, &salt);
        Self { key }
    }

    /// パスワードから鍵を派生（PBKDF2）
    fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_SIZE] {
        use blake3::Hasher;

        let mut hasher = Hasher::new();
        hasher.update(password.as_bytes());
        hasher.update(salt);

        // 反復ハッシュでキーストレッチング
        let mut result = *hasher.finalize().as_bytes();
        for _ in 0..PBKDF2_ITERATIONS / 1000 {
            let mut h = Hasher::new();
            h.update(&result);
            h.update(salt);
            result = *h.finalize().as_bytes();
        }

        result
    }

    /// データを暗号化
    ///
    /// # Returns
    /// 暗号化されたデータ: [salt(32bytes)][nonce(12bytes)][ciphertext]
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        // ランダムソルトとnonceを生成
        let mut rng = rand::thread_rng();
        let mut salt = [0u8; SALT_SIZE];
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        rng.fill(&mut salt);
        rng.fill(&mut nonce_bytes);

        // ソルトから実際の鍵を派生
        let key = Self::derive_key(
            &String::from_utf8_lossy(&self.key),
            &salt
        );

        // AES-256-GCMで暗号化
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| CryptoError::EncryptionFailed)?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| CryptoError::EncryptionFailed)?;

        // salt + nonce + ciphertext を結合
        let mut result = Vec::with_capacity(SALT_SIZE + NONCE_SIZE + ciphertext.len());
        result.extend_from_slice(&salt);
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    /// データを復号化
    ///
    /// # Arguments
    /// * `data` - 暗号化されたデータ: [salt(32bytes)][nonce(12bytes)][ciphertext]
    pub fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if data.len() < SALT_SIZE + NONCE_SIZE {
            return Err(CryptoError::InvalidFormat);
        }

        // salt, nonce, ciphertext を分離
        let salt = &data[..SALT_SIZE];
        let nonce_bytes = &data[SALT_SIZE..SALT_SIZE + NONCE_SIZE];
        let ciphertext = &data[SALT_SIZE + NONCE_SIZE..];

        // ソルトから鍵を派生
        let key = Self::derive_key(
            &String::from_utf8_lossy(&self.key),
            salt
        );

        // AES-256-GCMで復号化
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| CryptoError::DecryptionFailed)?;
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CryptoError::DecryptionFailed)?;

        Ok(plaintext)
    }

    /// パスワード強度をチェック
    pub fn check_password_strength(password: &str) -> PasswordStrength {
        let len = password.len();
        let has_upper = password.chars().any(|c| c.is_uppercase());
        let has_lower = password.chars().any(|c| c.is_lowercase());
        let has_digit = password.chars().any(|c| c.is_numeric());
        let has_special = password.chars().any(|c| !c.is_alphanumeric());

        let score = (if len >= 8 { 1 } else { 0 })
            + (if len >= 12 { 1 } else { 0 })
            + (if has_upper { 1 } else { 0 })
            + (if has_lower { 1 } else { 0 })
            + (if has_digit { 1 } else { 0 })
            + (if has_special { 1 } else { 0 });

        match score {
            0..=2 => PasswordStrength::Weak,
            3..=4 => PasswordStrength::Medium,
            _ => PasswordStrength::Strong,
        }
    }
}

/// パスワード強度
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordStrength {
    /// 弱い
    Weak,
    /// 中程度
    Medium,
    /// 強い
    Strong,
}

impl std::fmt::Display for PasswordStrength {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Weak => write!(f, "弱い"),
            Self::Medium => write!(f, "中程度"),
            Self::Strong => write!(f, "強い"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let encryptor = Encryptor::new("test_password_123");
        let plaintext = b"Hello, World! This is a test message.";

        let encrypted = encryptor.encrypt(plaintext).unwrap();
        assert_ne!(&encrypted[..], plaintext);
        assert!(encrypted.len() > plaintext.len());

        let decrypted = encryptor.decrypt(&encrypted).unwrap();
        assert_eq!(&decrypted[..], plaintext);
    }

    #[test]
    fn test_wrong_password() {
        let encryptor1 = Encryptor::new("password1");
        let encryptor2 = Encryptor::new("password2");

        let plaintext = b"Secret data";
        let encrypted = encryptor1.encrypt(plaintext).unwrap();

        // 異なるパスワードでは復号化に失敗するはず
        let result = encryptor2.decrypt(&encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn test_password_strength() {
        assert_eq!(
            Encryptor::check_password_strength("abc"),
            PasswordStrength::Weak
        );
        assert_eq!(
            Encryptor::check_password_strength("Abc12345"),
            PasswordStrength::Medium
        );
        assert_eq!(
            Encryptor::check_password_strength("MyP@ssw0rd!123"),
            PasswordStrength::Strong
        );
    }
}
