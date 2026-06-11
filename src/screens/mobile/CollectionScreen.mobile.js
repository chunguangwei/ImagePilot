/**
 * CollectionScreen —— 通用照片集合网格页
 *
 * route.params: { title, subtitle?, images: [...] }
 * 旅行回忆点进来用；之后任何"一组照片"的展示（精选/回忆集）都可复用。
 * 视频带 ▶+时长角标；点任意项进 ImagePreview（集合内左右滑）。
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri } from '../../adapters/WebAdapters';
import { useIosColors } from '../../ui/ios/theme';
import { formatDuration } from '../../components/shared/categoryUI';

const COLS = 3;
const PAD = 8;
const GAP = 2;

export default function CollectionScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const c = useIosColors();
  const { width: winW } = useWindowDimensions();
  const itemSize = (winW - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const title = route?.params?.title || t('collection.defaultTitle', { defaultValue: '照片集合' });
  const subtitle = route?.params?.subtitle || '';
  const images = Array.isArray(route?.params?.images) ? route.params.images : [];

  const renderItem = ({ item, index }) => {
    const uri = getUri(item) || item?.uri;
    const isVideo = String(item?.mimeType || '').startsWith('video/');
    return (
      <TouchableOpacity
        style={{ width: itemSize, height: itemSize, marginRight: (index % COLS === COLS - 1) ? 0 : GAP, marginBottom: GAP }}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ImagePreview', {
          image: item, allImages: images, currentIndex: index, fromScreen: 'collection',
        })}
      >
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
        {isVideo && (
          <View style={[styles.videoBadge, formatDuration(item.duration) ? styles.videoBadgeWide : null]} pointerEvents="none">
            <Text style={styles.videoBadgeIcon}>
              {'▶'}{formatDuration(item.duration) ? ` ${formatDuration(item.duration)}` : ''}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.label }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: c.tertiaryLabel }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {/* 幻灯片放映（视频自动跳过） */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Slideshow', { images, title })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="play-circle-outline" size={24} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
      </View>
      <FlatList
        data={images}
        keyExtractor={(item, idx) => String(item.id || idx)}
        renderItem={renderItem}
        numColumns={COLS}
        contentContainerStyle={{ padding: PAD }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, paddingVertical: 2 },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 11.5, marginTop: 1 },
  thumb: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.04)' },
  videoBadge: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoBadgeWide: { width: undefined, paddingHorizontal: 6 },
  videoBadgeIcon: { color: '#FFFFFF', fontSize: 11, marginLeft: 1 },
});
