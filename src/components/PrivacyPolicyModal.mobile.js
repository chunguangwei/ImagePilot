import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';

const PRIVACY_POLICY_URL = 'https://github.com/chunguangwei/ImagePilot/blob/main/pc-version-final/privacy-policy.html';
const PRIVACY_AGREED_KEY = '@privacy_policy_agreed';

const PrivacyPolicyModal = ({ visible, onAgree, onDisagree }) => {
  const { t } = useTranslation('common');
  const [agreed, setAgreed] = useState(false);

  const handleOpenPolicy = async () => {
    try {
      // Android 上 canOpenURL 可能返回 false，即使 URL 有效
      // 直接尝试打开，如果失败再处理错误
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch (error) {
      console.error('打开隐私政策链接失败:', error);
      // 如果打开失败，可以尝试使用浏览器打开
      try {
        // 备用方案：使用 Intent 打开（Android）
        if (Platform.OS === 'android') {
          await Linking.openURL(`intent://${PRIVACY_POLICY_URL.replace('https://', '')}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`);
        } else {
          // iOS 或其他平台
          await Linking.openURL(PRIVACY_POLICY_URL);
        }
      } catch (fallbackError) {
        console.error('备用方案也失败:', fallbackError);
        // 可以显示一个提示，让用户手动复制链接
        Alert.alert(
          t('privacy.openPolicy') || '打开隐私政策',
          `无法自动打开链接，请手动访问：\n${PRIVACY_POLICY_URL}`,
          [{ text: t('common.gotIt') || '知道了' }]
        );
      }
    }
  };

  const handleAgree = () => {
    if (agreed) {
      onAgree();
    }
  };

  const handleDisagree = () => {
    if (onDisagree) {
      onDisagree();
    }
  };

  // 只有复选框本身可以点击，标签文本不可点击
  const handleCheckboxPress = () => {
    setAgreed(!agreed);
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={() => {}} // Android 返回键禁用
    >
      <View style={styles.container}>
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.content}>
            <Text style={styles.title}>{t('privacy.title')}</Text>
            <Text style={styles.welcome}>{t('privacy.welcome')}</Text>
            <Text style={styles.description}>{t('privacy.description')}</Text>
            
            <View style={styles.policyLinkContainer}>
              <Text style={styles.policyText}>
                {t('privacy.readPolicy')}{' '}
              </Text>
              <TouchableOpacity onPress={handleOpenPolicy} activeOpacity={0.7}>
                <Text style={styles.policyLink}>
                  {t('privacy.privacyPolicy')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.checkboxContainer}>
              <TouchableOpacity
                style={styles.checkboxTouchable}
                onPress={handleCheckboxPress}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                  {agreed && <View style={styles.checkboxInner} />}
                </View>
              </TouchableOpacity>
              <Text style={styles.checkboxLabel}>
                {t('privacy.readPolicy')} {t('privacy.privacyPolicy')}
              </Text>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.disagreeButton]}
                onPress={handleDisagree}
              >
                <Text style={[styles.buttonText, styles.disagreeButtonText]}>
                  {t('privacy.disagree')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.agreeButton, !agreed && styles.buttonDisabled]}
                onPress={handleAgree}
                disabled={!agreed}
              >
                <Text style={[styles.buttonText, styles.agreeButtonText]}>
                  {t('privacy.agree')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 16,
    textAlign: 'center',
  },
  welcome: {
    fontSize: 18,
    color: '#666666',
    marginBottom: 24,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#666666',
    lineHeight: 24,
    marginBottom: 24,
    textAlign: 'center',
  },
  policyLinkContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  policyText: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    textAlign: 'center',
  },
  policyLink: {
    fontSize: 14,
    color: '#007AFF',
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    paddingHorizontal: 16,
    width: '100%',
  },
  checkboxTouchable: {
    marginRight: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#CCCCCC',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxChecked: {
    borderColor: '#007AFF',
    backgroundColor: '#007AFF',
  },
  checkboxInner: {
    width: 6,
    height: 10,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
    marginTop: -2,
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#333333',
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    paddingHorizontal: 16,
    gap: 12,
  },
  button: {
    width: '100%',
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
  },
  agreeButton: {
    backgroundColor: '#007AFF',
  },
  disagreeButton: {
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#CCCCCC',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  agreeButtonText: {
    color: '#FFFFFF',
  },
  disagreeButtonText: {
    color: '#666666',
  },
});

export default PrivacyPolicyModal;
export { PRIVACY_AGREED_KEY };
