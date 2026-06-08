import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorHome, loadSubcontractorProjects } from '../api/subcontractorApi';

function initials(name) {
  return String(name || 'SC').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || 'SC';
}

export default function HomeScreen({ session, onLogout, onOpenProject }) {
  const [home, setHome] = useState(null);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const columns = width >= 900 ? 3 : width >= 640 ? 2 : 1;

  const user = home?.user || session?.user || {};
  const subtitle = user?.subcontractor_name || user?.name || user?.email_address || 'Subcontractor';

  const load = useCallback(async (nextQuery = query, showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [homeData, projectData] = await Promise.all([
        loadSubcontractorHome(session.portalUrl, session.access_token),
        loadSubcontractorProjects(session.portalUrl, session.access_token, nextQuery),
      ]);
      setHome(homeData);
      setProjects(projectData?.projects || []);
    } catch (error) {
      Alert.alert('Unable to Load', error?.message || 'Could not load subcontractor projects.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, session?.portalUrl, session?.access_token]);

  useEffect(() => { load('', false); }, []);

  const content = useMemo(() => {
    if (loading) {
      return <View style={styles.loading}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Loading projects…</Text></View>;
    }
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(query, true)} />}
      >
        <View style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user?.name || user?.subcontractor_name)}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroTitle}>Projects Under Construction</Text>
            <Text style={styles.heroCopy}>Only active construction projects assigned to your subcontractor account are shown here.</Text>
          </View>
          <View style={styles.countPill}><Text style={styles.countText}>{projects.length}</Text></View>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query, false)}
            placeholder="Search active projects"
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
            returnKeyType="search"
          />
          <Pressable style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]} onPress={() => load(query, false)}>
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {!projects.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active projects found</Text>
            <Text style={styles.emptyCopy}>This account is not currently assigned to any active under-construction projects, or the search did not match any projects.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {projects.map((project) => (
              <Pressable
                key={project.site_name}
                style={({ pressed }) => [styles.projectCard, { width: `${100 / columns}%` }, pressed && styles.pressed]}
                onPress={() => onOpenProject(project, home?.pages || [])}
              >
                <View style={styles.innerProjectCard}>
                  <View style={styles.projectIcon}><Text style={styles.projectIconText}>🏗️</Text></View>
                  <Text style={styles.projectName} numberOfLines={2}>{project.site_name}</Text>
                  <Text style={styles.projectMeta}>Active construction</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }, [loading, refreshing, query, projects, columns, user, home, load, onOpenProject]);

  return (
    <ScreenShell title="FNS Subcontractor Portal" subtitle={subtitle} rightLabel="Logout" onRightPress={onLogout}>
      {content}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.muted, fontWeight: '800' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: colors.line, padding: 16, marginBottom: 14 },
  avatar: { width: 54, height: 54, borderRadius: 20, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.blue, fontWeight: '900', fontSize: 18 },
  heroTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  heroCopy: { color: colors.muted, lineHeight: 19, marginTop: 3, fontWeight: '600' },
  countPill: { minWidth: 44, height: 44, borderRadius: 16, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bbf7d0' },
  countText: { color: colors.green, fontWeight: '900', fontSize: 18 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12, fontWeight: '800', color: colors.text },
  searchButton: { backgroundColor: colors.blue, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  projectCard: { padding: 6 },
  innerProjectCard: { minHeight: 150, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 16, justifyContent: 'space-between' },
  projectIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  projectIconText: { fontSize: 24 },
  projectName: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '900', marginTop: 16 },
  projectMeta: { color: colors.green, fontWeight: '900', marginTop: 7 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 20 },
  emptyTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  emptyCopy: { color: colors.muted, fontWeight: '600', lineHeight: 20, marginTop: 8 },
  pressed: { opacity: 0.72 },
});
